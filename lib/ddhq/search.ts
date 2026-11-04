// Search from Decision Desk HQ's election pages: a query naming a county ("los angeles mayor") or a state ("georgia
// state senate") is answered from that county's or state's page, which DDHQ serves in about a tenth of a second,
// rather than waiting on civicAPI's search, which can take most of a minute on election night.
import { ELECTION_DATE } from "../midterms/races";
import type { FoundRace } from "../midterms/civic";
import { SEARCH_LIMIT } from "../midterms/civic";
import { normal } from "../midterms/county";
import countyNames from "../midterms/countyNames.json";
import { STATE_NAMES } from "../midterms/view";
import { DDHQ_LOCAL_BASE, ddhqRace, electionPath, pageRecords, type DdhqRecord } from "./elections";

const COUNTY_NAMES = countyNames as Record<string, Record<string, string>>;
/** One read of a page serves every search this long. */
const FRESH_MS = 60_000;
/** A search waits this long on one DDHQ page before leaving it to civicAPI. */
const WAIT_MS = 3_000;
/** Most pages one search reads: a county name shared by several states ("orange") reads the first few. */
const MAX_PAGES = 3;
const STOP = new Set(["of", "the", "for", "in", "and", "election", "race", "races", "county", "state"]);
/** Measures numbered like a state's ("Proposition 1"): tracked statewide measures, which show live already. */
const NUMBERED = /^(Proposition|Question|Amendment|Measure|Issue|Initiative|Referendum)\s+\d/i;

const words = (s: string) => normal(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
/** Whether `phrase`'s words sit together in `query`'s words. */
const holds = (query: string[], phrase: string[]) => phrase.length > 0 && query.some((_, i) => phrase.every((w, j) => query[i + j] === w));

export type Page = { state: string; county?: string };

/**
 * The DDHQ pages a query names: each county whose name it holds (only the named state's when it names one), else the
 * named state's own page. Nothing when it names no place, so an office alone ("school board") is left to civicAPI.
 */
export function pagesFor(query: string): Page[] {
  const q = words(query);
  const states = Object.entries(STATE_NAMES).filter(([, name]) => holds(q, words(name))).map(([code]) => code);
  const counties = Object.entries(COUNTY_NAMES)
    .filter(([state]) => !states.length || states.includes(state))
    .flatMap(([state, byFips]) => Object.values(byFips).filter((name) => holds(q, words(name))).map((county) => ({ state, county })))
    // Santa Clara County's own feed answers for it (lib/midterms/county.ts).
    .filter((p) => !(p.state === "CA" && p.county === "Santa Clara"))
    // A state's name isn't read as its county's too ("new york" is both) unless the query says county or city.
    .filter((p) => normal(p.county) !== normal(STATE_NAMES[p.state] ?? "") || /\b(county|city)\b/.test(normal(query)));
  if (counties.length) return counties.slice(0, MAX_PAGES);
  return states.slice(0, MAX_PAGES).map((state) => ({ state }));
}

/** DDHQ's race records as found races; tracked offices (Congress, governors, numbered state measures) are left out, as they show live. */
export function foundFrom(records: readonly DdhqRecord[], page: Page): { race: FoundRace; haystack: string; office: string }[] {
  return records.flatMap((r) => {
    const level = r.level ?? "";
    const question = /ballot question/i.test(r.name) || /ballot question/i.test(r.electionType ?? "");
    if (/^Federal/i.test(level) || /^Governor$/i.test(r.office) || (/Referendum/i.test(level) && NUMBERED.test(r.office))) return [];
    const summary = ddhqRace(r);
    const local = level === "City" || level === "Universal";
    const legislature = /State\/District/i.test(level);
    const type = question ? "Ballot Measure" : legislature ? "State Legislature" : local ? (summary.local?.type ?? "Local") : r.office;
    const race: FoundRace = {
      id: DDHQ_LOCAL_BASE + r.id,
      title: summary.title,
      state: r.stateAbb,
      type,
      date: ELECTION_DATE,
      kind: local ? "local" : "statewide",
      url: summary.source?.url,
    };
    const place = `${page.county ?? ""} ${STATE_NAMES[r.stateAbb] ?? r.stateAbb}`;
    return [{ race, office: normal(summary.title), haystack: normal(`${summary.title} ${type} ${place}`) }];
  });
}

/** The races matching every word of `query` (place words included), those naming the most of them in their title first. */
export function matchFound(query: string, found: readonly { race: FoundRace; haystack: string; office: string }[]): FoundRace[] {
  const want = words(query);
  if (!want.length) return [];
  const has = (text: string, w: string) => new RegExp(`\\b${w}`).test(text);
  const seen = new Set<number>();
  return found
    .filter((f) => want.every((w) => has(f.haystack, w)) && !seen.has(f.race.id) && seen.add(f.race.id))
    .map((f, i) => ({ f, i, score: want.filter((w) => has(f.office, w)).length }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, SEARCH_LIMIT)
    .map(({ f }) => f.race);
}

const memo = new Map<string, { at: number; records: DdhqRecord[] }>();

async function records(page: Page, now: number): Promise<DdhqRecord[]> {
  const path = electionPath(page.state, page.county);
  const held = memo.get(path);
  if (held && now - held.at < FRESH_MS) return held.records;
  try {
    const read = await pageRecords(path, WAIT_MS);
    memo.set(path, { at: now, records: read });
    return read;
  } catch (err) {
    console.error(`DDHQ search page ${path} failed:`, err instanceof Error ? err.message : err);
    if (held) return held.records;
    throw err;
  }
}

/** The races on the DDHQ pages `query` names that match it. Empty when it names no place; throws only when every page failed. */
export async function searchDdhq(query: string, now: number): Promise<FoundRace[]> {
  const pages = pagesFor(query);
  if (!pages.length) return [];
  const read = await Promise.allSettled(pages.map((p) => records(p, now)));
  if (read.every((r) => r.status === "rejected")) throw (read[0] as PromiseRejectedResult).reason;
  return matchFound(query, read.flatMap((r, i) => (r.status === "fulfilled" ? foundFrom(r.value, pages[i]) : [])));
}

/**
 * DDHQ's, the county feed's and civicAPI's results together, up to SEARCH_LIMIT. A race both DDHQ and civicAPI list
 * (same state and title) keeps civicAPI's entry, which opens our own race page.
 */
export function withDdhq(ddhq: readonly FoundRace[], rest: readonly FoundRace[]): FoundRace[] {
  const key = (r: FoundRace) => `${r.state}|${normal(r.title).replace(/[^a-z0-9]+/g, " ").trim()}`;
  const known = new Set(rest.map(key));
  const fresh = ddhq.filter((r) => !known.has(key(r)));
  return [...rest.filter((r) => r.date === ELECTION_DATE), ...fresh, ...rest.filter((r) => r.date !== ELECTION_DATE)].slice(0, SEARCH_LIMIT);
}
