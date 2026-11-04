// Decision Desk HQ's public election pages: a county's page (votes.decisiondeskhq.com/elections/2026-11-03/california/
// santa-clara) lists every race on its ballots, local ones too, each with its count, DDHQ's expected vote and its
// slug, and statewide races with their statewide count. No login; fetched like the Pulse pages (lib/ddhq/pulse.ts).
import { z } from "zod";
import { appEnv } from "../env";
import { ELECTION_DATE, type RaceSummary } from "../midterms/races";
import { STATE_NAMES } from "../midterms/view";

const VOTES = "https://votes.decisiondeskhq.com";
const HEADERS = {
  accept: "text/x-component",
  RSC: "1",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  referer: `${VOTES}/`,
};
/** One read serves every visitor this long. */
const FRESH_MS = 30_000;
/** A page read is given up after this long, so a slow DDHQ can't hold Near you past its own limit. */
const WAIT_MS = 8_000;
/** DDHQ local race ids are this plus DDHQ's id, far above civicAPI's and the county feed's (lib/midterms/county.ts). */
export const DDHQ_LOCAL_BASE = 200_000_000;
export const isDdhqLocal = (id: number) => id > DDHQ_LOCAL_BASE;

const count = z.number().nonnegative().catch(0);
const record = z.object({
  name: z.string(),
  stateAbb: z.string().regex(/^[A-Z]{2}$/),
  office: z.string().min(1),
  district: z.string().nullish(),
  electionType: z.string().nullish(),
  /** "City", "Universal" (other local), "Statewide", "State/District", "State Referendum", "Federal", "Federal/District". */
  level: z.string().nullish(),
  id: z.number().int().positive(),
  slug: z.string().nullish(),
  turnout: z.object({ estimated_votes_mid: count, precincts_in: count, precincts_tot: count }).partial().nullish(),
  toplineResults: z.array(z.object({ firstName: z.string().nullish(), lastName: z.string().nullish(), votes: count, percent: count.nullish(), winner: z.boolean().nullish(), color: z.string().nullish(), party: z.object({ name: z.string().nullish() }).nullish() })),
  totalVotes: count,
});
export type DdhqRecord = z.output<typeof record>;

/** Every race record in a page: the JSON objects opening with "race_date", each read whole. */
export function raceRecords(text: string): DdhqRecord[] {
  const out = new Map<number, DdhqRecord>();
  for (let i = text.indexOf('{"race_date"'); i >= 0; i = text.indexOf('{"race_date"', i + 1)) {
    let depth = 0;
    let quoted = false;
    let j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (quoted) {
        if (ch === "\\") j++;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) break;
    }
    try {
      const parsed = record.safeParse(JSON.parse(text.slice(i, j + 1)));
      if (parsed.success && !out.has(parsed.data.id)) out.set(parsed.data.id, parsed.data);
    } catch {
      // A record cut short: skipped.
    }
  }
  return [...out.values()];
}

const HEX = /^#[0-9a-f]{6}$/i;
const QUESTION = /ballot question/i;

/** A DDHQ race as the tracker's local race shape: its share of DDHQ's expected vote counted, and that expected vote. */
export function ddhqRace(r: DdhqRecord): RaceSummary {
  const question = QUESTION.test(r.name) || QUESTION.test(r.electionType ?? "");
  const total = r.totalVotes || r.toplineResults.reduce((s, c) => s + c.votes, 0);
  const expected = r.turnout?.estimated_votes_mid || 0;
  const precincts = r.turnout?.precincts_tot ? ((r.turnout.precincts_in ?? 0) / r.turnout.precincts_tot) * 100 : null;
  const reporting = expected > 0 ? Math.min(99, (total / expected) * 100) : precincts;
  const type = question ? "Ballot Measure" : /school/i.test(r.office) ? "School Board" : /council/i.test(r.office) ? "City Council" : /mayor/i.test(r.office) ? "Mayor" : "Local";
  return {
    id: DDHQ_LOCAL_BASE + r.id,
    office: "measure",
    state: r.stateAbb,
    district: null,
    // An at-large seat is for the whole place, not a district of it.
    title: r.district && !/^at-?large$/i.test(r.district) ? `${r.office}, District ${r.district}` : r.office,
    reporting: reporting ?? 0,
    ...(reporting === null && total > 0 ? { reportingUnknown: true as const } : {}),
    ...(expected > 0 ? { expected } : {}),
    total,
    candidates: r.toplineResults
      .map((c) => ({
        name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Candidate",
        party: c.party?.name ?? "Nonpartisan",
        votes: c.votes,
        pct: total > 0 ? (c.votes / total) * 100 : 0,
        winner: !!c.winner,
        incumbent: false,
        ...(!question && c.color && HEX.test(c.color) ? { color: c.color } : {}),
      }))
      .sort((a, b) => b.votes - a.votes),
    rating: null,
    local: { kind: question ? "question" : "candidates", type, date: ELECTION_DATE },
    source: { name: "Decision Desk HQ", url: r.slug ? `${VOTES}/races/${r.slug}` : VOTES },
  };
}

/** "santa-clara" from "Santa Clara County", as DDHQ's paths name counties. */
export const countySlug = (county: string) =>
  county.replace(/\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const stateSlug = (code: string) => (STATE_NAMES[code] ?? code).toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** "/elections/2026-11-03/california" (a state's page) or ".../california/los-angeles" (a county's) on DDHQ. */
export const electionPath = (state: string, county?: string) => `/elections/${ELECTION_DATE}/${stateSlug(state)}${county ? `/${countySlug(county)}` : ""}`;

/** The race records on one of DDHQ's election pages, read through the egress in Workers; throws when it can't be read. */
export async function pageRecords(path: string, wait = WAIT_MS): Promise<DdhqRecord[]> {
  let egress: Fetcher | undefined;
  try {
    egress = appEnv().DDHQ_EGRESS;
  } catch {
    // Outside Workers (tests, scripts): DDHQ is asked directly.
  }
  const signal = AbortSignal.timeout(wait);
  const res = egress ? await egress.fetch(new Request(VOTES + path, { redirect: "manual", signal })) : await fetch(VOTES + path, { headers: HEADERS, redirect: "manual", signal });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("text/x-component")) throw new Error(`HTTP ${res.status}`);
  return raceRecords(await res.text());
}

const memo = new Map<string, { at: number; races: RaceSummary[] }>();

/**
 * The races on one county's DDHQ page, fresh for FRESH_MS; the last good read when DDHQ fails; null when there's no
 * such page or it can't be read at all.
 */
export async function countyRaces(state: string, county: string, now: number): Promise<{ races: RaceSummary[]; at: number; stale: boolean } | null> {
  const path = electionPath(state, county);
  const held = memo.get(path);
  if (held && now - held.at < FRESH_MS) return { ...held, stale: false };
  try {
    const races = (await pageRecords(path)).map(ddhqRace);
    if (!races.length) throw new Error("no races");
    memo.set(path, { at: now, races });
    return { at: now, races, stale: false };
  } catch (err) {
    console.error(`DDHQ county page ${path} failed:`, err instanceof Error ? err.message : err);
    return held ? { ...held, stale: true } : null;
  }
}
