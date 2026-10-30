import { z } from "zod";
import { CivicError, FRESH_MS, SEARCH_LIMIT, type Fetched, type FoundRace } from "./civic";
import { blankResults, ELECTION_DATE, FIRST_POLLS_OPEN, raceDetail, summarizeOther, type RaceDetail, type RaceSummary } from "./races";
import { SANTA_CLARA_RESULTS } from "./view";

// Santa Clara County's own election-night results, for the city, school and district races and local measures that
// civicAPI doesn't carry in California. The county publishes them through Clarity ENR, whose JSON is public and keyless.
const FEED = "https://results.enr.clarityelections.com/CA/Santa_Clara/127570/";
const SOURCE = { name: "Santa Clara County", url: SANTA_CLARA_RESULTS };
/** County race ids are this plus Clarity's contest number, far above civicAPI's ids (about 173,000 in 2026). */
export const COUNTY_ID_BASE = 90_000_000;
const COUNTY_ID_SPAN = 1_000_000;
/** Clarity's categories for races civicAPI lacks; state and federal races, judges and propositions come from civicAPI. */
const CATEGORIES = new Set(["Local", "School", "Measures"]);
/** One request is given up after this long, as with civicAPI. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The county's feed couldn't be read. A CivicError, so routes answer with the same "results unavailable" message. */
export class CountyError extends CivicError {}

export const isCountyRace = (id: number) => id > COUNTY_ID_BASE && id < COUNTY_ID_BASE + COUNTY_ID_SPAN;

const contestSchema = z.object({
  CAT: z.string().nullish(),
  C: z.string(),
  K: z.string().regex(/^\d+$/),
  /** How many candidates each voter picks: the seats up. */
  VF: z.number().nullish(),
  /** Precincts in all, and reporting. */
  TP: z.number().nullish(),
  PR: z.number().nullish(),
  CH: z.array(z.string()),
  P: z.array(z.string()).nullish(),
  V: z.array(z.number()),
});
type Contest = z.output<typeof contestSchema>;
type Feed = { at: number; contests: Contest[]; updated: string | null };

/** Clarity's abbreviations, spelled out for titles and search: "Fremont Union HSD, TA 4" → "Fremont Union High School District, Trustee Area 4". */
const SPELLED: [RegExp, string][] = [
  [/\bHSD\b/g, "High School District"],
  [/\bCCD\b/g, "Community College District"],
  [/\bSD\b/g, "School District"],
  [/\bBOE\b/g, "Board of Education"],
  [/\bTA\b/g, "Trustee Area"],
  [/, D(\d+)\b/g, ", District $1"],
];

function titleOf(c: Contest): string {
  const name = SPELLED.reduce((s, [abbr, full]) => s.replace(abbr, full), c.C.replace(/\s+/g, " ").trim());
  return c.VF && c.VF > 1 ? `${name}, ${c.VF} seats` : name;
}

function typeOf(c: Contest): string {
  if (c.CAT === "Measures") return "Ballot Measure";
  if (c.CAT === "School") return "School Board";
  if (/^Mayor\b/.test(c.C)) return "Mayor";
  return /\bCouncil\b/.test(c.C) ? "City Council" : "Special District";
}

/** Words people use for each type that the contest's own name may not hold. */
const ALIASES: Record<string, string> = {
  "School Board": "school board board of education trustee",
  "City Council": "city council",
  "Special District": "district board director",
  "Ballot Measure": "ballot measure proposition question",
};

/** A school district's acronym, from its name before the first comma: "Palo Alto Unified SD" → "pausd". */
const acronymOf = (c: Contest) =>
  c.CAT === "School"
    ? c.C.split(",")[0]
        .split(/[\s-]+/)
        .map((w) => (/^(SD|HSD|CCD|BOE)$/.test(w) ? w : w[0]))
        .join("")
        .toLowerCase()
    : "";

/** Lowercased, accents dropped and hyphens split, so "San José-Evergreen" matches "san jose evergreen". */
export const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/-/g, " ").toLowerCase();
const STOP = new Set(["of", "the", "for", "in", "and", "election", "race", "races"]);
const words = (q: string) => normal(q).split(/\s+/).filter((w) => w && !STOP.has(w));

const haystack = (c: Contest) => normal(`${titleOf(c)} ${ALIASES[typeOf(c)]} ${acronymOf(c)} santa clara county california`);

/** Clarity marks names with doubled single quotes ("Yu ''Yudy'' Deng") and measures' sides in capitals. */
const candidateName = (name: string) => (/^(YES|NO)$/.test(name) ? name[0] + name.slice(1).toLowerCase() : name.replace(/''/g, '"'));

/** "11/3/2026 9:15:02 PM PST", the feed's update time, as an ISO time. Null when it reads otherwise. */
export function updatedAt(stamp: unknown): string | null {
  const m = typeof stamp === "string" ? /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM) (PDT|PST)$/.exec(stamp.trim()) : null;
  if (!m) return null;
  const pad = (n: string | number) => String(n).padStart(2, "0");
  const hour = (Number(m[4]) % 12) + (m[7] === "PM" ? 12 : 0);
  return `${m[3]}-${pad(m[1])}-${pad(m[2])}T${pad(hour)}:${m[5]}:${m[6]}${m[8] === "PDT" ? "-07:00" : "-08:00"}`;
}

/** A contest in civicAPI's race shape, so it's summarized and shown by the same code as civicAPI's local races. */
function asCivic(c: Contest, updated: string | null) {
  return {
    id: COUNTY_ID_BASE + Number(c.K),
    type: typeOf(c),
    country: "US",
    province: "CA",
    election_name: titleOf(c),
    election_type: "Local",
    election_date: `${ELECTION_DATE}T08:00:00.000Z`,
    percent_reporting: c.TP ? ((c.PR ?? 0) / c.TP) * 100 : null,
    // The county lists a write-in line in every contest; it's kept only once it has votes.
    candidates: c.CH.map((name, i) => ({ name: candidateName(name), party: c.P?.[i] || "Nonpartisan", votes: c.V[i] ?? 0 })).filter((x) => x.votes > 0 || !/^write-in$/i.test(x.name)),
    last_updated: updated,
  };
}

async function get(path: string): Promise<Response> {
  let res: Response;
  try {
    // As with civicAPI, the edge shares one fetch per data center among everyone polling.
    res = await fetch(FEED + path, { cf: { cacheTtl: 10, cacheEverything: true }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } as RequestInit);
  } catch {
    throw new CountyError("Couldn't reach Santa Clara County's results.");
  }
  if (!res.ok) throw new CountyError(`Santa Clara County's results returned ${res.status}.`);
  return res;
}

/** The feed's current contests: Clarity names the latest version in current_ver.txt and serves each under its own path. */
async function load(now: number): Promise<Feed> {
  const version = (await (await get("current_ver.txt")).text()).trim();
  if (!/^\d+$/.test(version)) throw new CountyError("Santa Clara County's results gave no version.");
  const [summary, settings] = await Promise.all([get(`${version}/json/en/summary.json`).then((r) => r.json()), get(`${version}/json/en/electionsettings.json`).then((r) => r.json())]);
  if (!Array.isArray(summary)) throw new CountyError("Santa Clara County's results didn't parse.");
  const contests = summary.flatMap((c) => {
    const parsed = contestSchema.safeParse(c);
    return parsed.success && CATEGORIES.has(parsed.data.CAT ?? "") ? [parsed.data] : [];
  });
  return { at: now, contests, updated: updatedAt((settings as { websiteupdatedat?: unknown } | null)?.websiteupdatedat) };
}

let memo: Feed | null = null;
/** The fetch under way, so searches and race pages arriving together share one. */
let inFlight: Promise<Feed> | null = null;

export function resetCountyMemo() {
  memo = null;
  inFlight = null;
}

/** The feed, fresh for FRESH_MS; when the county fails, the last good copy marked stale. */
async function feed(now: number): Promise<Feed & { stale: boolean }> {
  if (memo && now - memo.at < FRESH_MS) return { ...memo, stale: false };
  inFlight ??= load(now).finally(() => {
    inFlight = null;
  });
  try {
    memo = await inFlight;
    return { ...memo, stale: false };
  } catch (err) {
    if (memo) return { ...memo, stale: true };
    throw err;
  }
}

/** Santa Clara County races holding every word of `query` in their name, type, district acronym or place. */
export async function searchCounty(query: string, now: number): Promise<FoundRace[]> {
  const want = words(query);
  if (!want.length) return [];
  const { contests } = await feed(now);
  return contests
    .filter((c) => want.every((w) => haystack(c).includes(w)))
    .slice(0, SEARCH_LIMIT)
    .map((c) => ({ id: COUNTY_ID_BASE + Number(c.K), title: titleOf(c), state: "CA", type: typeOf(c), date: ELECTION_DATE, kind: "local" as const }));
}

/** Words that name an office or kind of race rather than a place. */
const OFFICE_WORDS = new Set(["school", "board", "education", "trustee", "trustees", "district", "council", "city", "town", "mayor", "measure", "measures", "ballot", "proposition", "unified", "union", "high", "college", "community", "water"]);

/**
 * County and civicAPI results together, up to SEARCH_LIMIT. A search naming a place lists the county's matches
 * first; one naming only an office ("school board") lists civicAPI's nationwide results first.
 */
export function mergeFound(query: string, county: readonly FoundRace[], civic: readonly FoundRace[]): FoundRace[] {
  const placeless = words(query).every((w) => OFFICE_WORDS.has(w));
  return (placeless ? [...civic, ...county] : [...county, ...civic]).slice(0, SEARCH_LIMIT);
}

/** What a county race carries beyond civicAPI's shape: its source, and for a measure what it's about ("Measure J - City of Palo Alto, Transactions and Use Tax"). */
function countyFields(c: Contest): Pick<RaceSummary, "source" | "about"> {
  const about = c.CAT === "Measures" ? c.C.split(" - ").slice(1).join(" - ").trim() : "";
  return { source: SOURCE, ...(about && { about: { text: about, url: null } }) };
}

/** A Santa Clara County race by id, shaped like civicAPI's local races for the race page. Null when the county has no such race. */
export async function fetchCountyRace(id: number, now: number): Promise<Fetched<{ race: RaceDetail }> | null> {
  if (!isCountyRace(id)) return null;
  const { contests, updated, at, stale } = await feed(now);
  const contest = contests.find((c) => COUNTY_ID_BASE + Number(c.K) === id);
  if (!contest) return null;
  const input = asCivic(contest, updated);
  const summary = summarizeOther(input, now);
  if (!summary) return null;
  const detail: RaceDetail = { ...raceDetail(summary, input, {}, now), ...countyFields(contest) };
  // Like civicAPI's races, a Nov 3 race shows no numbers before polls open, in case the county posts test counts.
  return { race: now < FIRST_POLLS_OPEN ? blankResults(detail) : detail, fetchedAt: at, stale };
}

/** Where an address votes, as the Census names it: "Palo Alto city", "Mountain View Whisman Elementary School District". */
export type Area = { city: string | null; schools: readonly string[] };

/** Words the Census and the county spell differently in school district names ("Joint Union School District" / "Union HSD"). */
const SCHOOL_WORDS = /\b(school|district|elementary|high|joint|union|unified|sd|hsd|esd|usd)\b/g;
const schoolCore = (name: string) => normal(name).replace(SCHOOL_WORDS, " ").replace(/\s+/g, " ").trim();
/** A contest for part of a city or district (a council district, a trustee area), which the Census can't place an address in. */
const SUB_AREA = /,\s*(District|D|Trustee Area|TA|Ward)\s*[A-Z0-9]+\b/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a contest is for the address's city or one of its school districts. */
function serves(c: Contest, area: Area): boolean {
  const city = area.city ? normal(area.city).replace(/\s(city|town|village|cdp)$/, "") : null;
  if (city && new RegExp(`\\b(city|town) of ${escapeRe(city)}\\b`).test(normal(c.C))) return true;
  // A school contest is named for its district ("Palo Alto Unified SD, TA 2"); a school measure names it after the dash.
  const district = c.CAT === "School" ? c.C.split(",")[0] : c.CAT === "Measures" && /school district/i.test(c.C) ? (c.C.split(" - ")[1] ?? "").split(",")[0] : "";
  return !!district && area.schools.some((s) => schoolCore(s) === schoolCore(district));
}

function summaryOf(c: Contest, updated: string | null, now: number): RaceSummary | null {
  const summary = summarizeOther(asCivic(c, updated), now);
  return summary && { ...(now < FIRST_POLLS_OPEN ? blankResults(summary) : summary), ...countyFields(c) };
}

/**
 * Santa Clara County races for an address in the county: `yours` are for its city or school districts; `nearby` are
 * for part of them (a council district, a trustee area), which may or may not include the address.
 */
export async function countyRacesFor(area: Area, now: number): Promise<{ yours: RaceSummary[]; nearby: RaceSummary[]; fetchedAt: number; stale: boolean }> {
  const { contests, updated, at, stale } = await feed(now);
  const summarized = (list: Contest[]) => list.flatMap((c) => summaryOf(c, updated, now) ?? []);
  const served = contests.filter((c) => serves(c, area));
  return { yours: summarized(served.filter((c) => !SUB_AREA.test(c.C))), nearby: summarized(served.filter((c) => SUB_AREA.test(c.C))), fetchedAt: at, stale };
}
