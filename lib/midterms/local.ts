import type { Districts } from "../ballot/census";
import { countyRaces } from "../ddhq/elections";
import { searchLive } from "./civic";
import { countyRacesFor, normal } from "./county";
import countyNames from "./countyNames.json";
import type { RaceSummary } from "./races";
import { STATE_NAMES } from "./view";

/**
 * The races near a saved address, for the "Near you" tab. `yours` are confirmed by the address's districts; `nearby`
 * are in its city or county but may be for a district it isn't in; `legislature` holds its state senate and house
 * seats. `state` and `house` (0 at-large) pick out its tracked races (governor, Senate, House, statewide measures),
 * which the page already has. `area` names the place, never the street.
 */
export type LocalRaces = {
  area: string;
  state: string | null;
  /** The address's county on the state's map. */
  countyFips: string | null;
  house: number | null;
  legislature: RaceSummary[];
  yours: RaceSummary[];
  nearby: RaceSummary[];
  /** The state's ballot measures from DDHQ's county page, statewide counts, to stand in where civicAPI's lag. */
  measures?: RaceSummary[];
  source: "ddhq" | "county" | "civicAPI";
  fetchedAt: number;
  stale: boolean;
};
/** What /api/midterms/local answers: `local` is null until the voter saves an address. */
export type LocalAnswer = { fetchedAt: number; stale?: boolean; local: Omit<LocalRaces, "fetchedAt" | "stale"> | null };
type CityAndCounty = Pick<LocalRaces, "yours" | "nearby" | "source" | "fetchedAt" | "stale" | "measures">;

/** "Palo Alto city" → "Palo Alto": the Census adds the kind of place to its names. */
const placeName = (place: string | null) => place?.replace(/\s+(city|town|village|borough|CDP|zona urbana)$/i, "") ?? null;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether `name` holds `phrase` as whole words, ignoring case and accents. */
const names = (name: string, phrase: string) => new RegExp(`\\b${escapeRe(normal(phrase))}\\b`).test(normal(name));

const COUNTY_NAMES = countyNames as Record<string, Record<string, string>>;

/**
 * A county's FIPS code from its Census name. The map's names drop the kind ("Santa Clara County" → "Santa Clara"),
 * and an independent city shares its name with a county ("Richmond city", "Richmond County"); cities' codes start at 510.
 */
export function countyFips(state: string, county: string | null): string | null {
  if (!county) return null;
  const city = / city$/.test(county);
  const name = county.replace(/\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$| city$/, "");
  const inState = COUNTY_NAMES[state] ?? {};
  const hits = Object.keys(inState).filter((fips) => inState[fips] === name);
  return hits.find((fips) => Number(fips.slice(2)) >= 510 === city) ?? hits[0] ?? null;
}

/** "Congressional District 16" → 16, "Congressional District (at Large)" → 0, as the tracked House races number them. */
function houseDistrict(name: string | null): number | null {
  if (!name) return null;
  if (/at large/i.test(name)) return 0;
  const n = name.match(/(\d+)\s*$/);
  return n ? Number(n[1]) : null;
}

/** civicAPI's name for each state's lower chamber, where it isn't "State House". */
const LOWER: Record<string, string> = { CA: "State Assembly", NV: "State Assembly", NY: "State Assembly", WI: "State Assembly", NJ: "State Assembly", MD: "House of Delegates", VA: "House of Delegates", WV: "House of Delegates" };

/**
 * The address's state senate and house seats on civicAPI. Its search matches loosely ("State House 5" finds 35 and
 * 159), so the seat is the race whose name ends in the district exactly ("12A", not "12B"). A failed search leaves
 * its seat out and marks the answer stale.
 */
async function legislature(districts: Districts, state: string, now: number): Promise<{ races: RaceSummary[]; stale: boolean }> {
  const seats = [
    { name: districts.stateSenate, chamber: "State Senate", type: "State Senate" },
    { name: districts.stateHouse, chamber: LOWER[state] ?? "State House", type: "State House" },
  ].flatMap((seat) => {
    const district = seat.name?.trim().match(/(\d+[A-Za-z]?)$/)?.[1].replace(/^0+/, "");
    return district ? [{ ...seat, district }] : [];
  });
  const answers = await Promise.allSettled(seats.map((seat) => searchLive(`${districts.state} ${seat.chamber} ${seat.district}`, now)));
  const races = answers.flatMap((answer, i) => {
    if (answer.status !== "fulfilled") return [];
    const { type, district } = seats[i];
    return answer.value.races.filter((r) => r.state === state && r.local?.type === type && new RegExp(`\\s0*${escapeRe(district)}$`, "i").test(r.title)).slice(0, 1);
  });
  return { races, stale: answers.some((a) => a.status === "rejected" || a.value.stale) };
}

/** Words that name a school district's kind rather than the district: "Palo Alto Unified School District" → "palo alto". */
const SCHOOL_KIND = /\b(school|district|elementary|high|joint|union|unified|board|of|education|trustees?|sd|hsd|esd|usd)\b/g;
const schoolCore = (name: string) => normal(name).replace(SCHOOL_KIND, " ").replace(/\s+/g, " ").trim();
/** A contest for part of a city or district (a council district, a trustee area), which the Census can't place an address in. */
const SUB_AREA = /,\s*District\s+\S+$|\b(Trustee Area|Ward|District)\s+\d+[A-Z]?\b/i;
/** A statewide measure on a county page, named by its number ("Proposition 1 - …"), not by a place ("Palo Alto Measure J"). */
const STATEWIDE_MEASURE = /^(Proposition|Question|Amendment|Constitutional Amendment|Issue|Measure|Initiative|Referendum)\s+\d/i;

/**
 * The address's races among a DDHQ county page's: its city's, its school districts' and its county's, `yours` unless
 * for part of one (a council district, a trustee area), which go to `nearby`; and the state's measures.
 */
export function pickDdhq(races: readonly RaceSummary[], districts: Districts, state: string, place: string | null): Pick<CityAndCounty, "yours" | "nearby" | "measures"> {
  const county = (districts.county ?? "").replace(/\s+(County|Parish|Borough)$/i, "");
  const schools = [districts.schoolDistrict, districts.highSchoolDistrict].filter((s): s is string => !!s).map(schoolCore).filter(Boolean);
  const mine = races.filter((r) => {
    const title = r.title;
    if (STATEWIDE_MEASURE.test(title)) return false;
    if (place && names(title.split(/\s+(Measure|City Council|Mayor|Council)\b/)[0], place)) return true;
    if (/school|education|trustees/i.test(title) && schools.includes(schoolCore(title.split(/\s+(school board|Measure|Board of)\b/i)[0]))) return true;
    return !!county && new RegExp(`^${escapeRe(county)} County\\b`, "i").test(title);
  });
  return {
    yours: mine.filter((r) => !SUB_AREA.test(r.title)),
    nearby: mine.filter((r) => SUB_AREA.test(r.title)),
    measures: races.filter((r) => STATEWIDE_MEASURE.test(r.title) && r.state === state),
  };
}

/** The address's races from DDHQ's county page (see pickDdhq); null when DDHQ has no page for the county or none match. */
async function fromDdhq(districts: Districts, state: string, place: string | null, now: number): Promise<CityAndCounty | null> {
  if (!districts.county) return null;
  const page = await countyRaces(state, districts.county, now);
  if (!page) return null;
  const picked = pickDdhq(page.races, districts, state, place);
  if (!picked.yours.length && !picked.nearby.length) return null;
  return { source: "ddhq", ...picked, fetchedAt: page.at, stale: page.stale };
}

async function cityAndCounty(districts: Districts, state: string | null, place: string | null, now: number): Promise<CityAndCounty> {
  // DDHQ's county page first, where it has one: every local contest with its count and expected vote.
  const ddhq = state ? await fromDdhq(districts, state, place, now).catch(() => null) : null;
  if (ddhq) return ddhq;

  // Santa Clara County publishes every local contest; its city and school districts say which are on this ballot.
  if (districts.state === "California" && districts.county === "Santa Clara County") {
    const schools = [districts.schoolDistrict, districts.highSchoolDistrict].filter((s): s is string => !!s);
    return { source: "county", ...(await countyRacesFor({ city: districts.place, schools }, now)) };
  }

  // Elsewhere civicAPI is searched by the city's and county's names, keeping Nov 3 races in this state that name either.
  // Its search only finds school boards when asked for them, so that's searched too.
  const terms = [place, districts.county].filter((t): t is string => !!t);
  if (!state || !terms.length) return { source: "civicAPI", yours: [], nearby: [], fetchedAt: now, stale: false };
  const answers = await Promise.allSettled([...terms, `${terms[0]} school board`].map((query) => searchLive(query, now)));
  const answered = answers.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
  if (!answered.length) throw (answers[0] as PromiseRejectedResult).reason;
  const seen = new Set<number>();
  const nearby = answered
    .flatMap((a) => a.races)
    .filter((r) => r.state === state && terms.some((t) => names(r.title, t)) && !seen.has(r.id) && seen.add(r.id));
  return { source: "civicAPI", yours: [], nearby, fetchedAt: now, stale: answered.length < answers.length || answered.some((a) => a.stale) };
}

export async function localRaces(districts: Districts, now: number): Promise<LocalRaces> {
  const place = placeName(districts.place);
  const area = [place, districts.county, districts.state].filter(Boolean).join(", ");
  const state = Object.keys(STATE_NAMES).find((code) => STATE_NAMES[code] === districts.state) ?? null;
  const [local, seats] = await Promise.all([cityAndCounty(districts, state, place, now), state ? legislature(districts, state, now) : { races: [], stale: false }]);
  return { area, state, countyFips: state && countyFips(state, districts.county), house: houseDistrict(districts.congressional), legislature: seats.races, ...local, stale: local.stale || seats.stale };
}
