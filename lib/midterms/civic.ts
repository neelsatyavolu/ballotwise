import { blankResults, ELECTION_DATE, FIRST_POLLS_OPEN, raceDetail, summarize, type RaceDetail, type RaceSummary, type RatedRace } from "./races";

// civicAPI (civicapi.org): free, keyless live results sourced from each Secretary of State. Its terms ask for attribution.
const BASE = "https://civicapi.org/api/v2/";
const PAGE = 500;
// The race types that hold Senate, House, Governor and statewide-measure races. Others are filtered out in summarize().
const TYPES = ["US Senate", "House of Representatives", "Governor", "Referendum", "Proposition", "Ballot Measure"];
/** How long a fetched catalog or race is reused before asking civicAPI again. civicAPI itself caches for 15s. */
export const FRESH_MS = 30_000;

export class CivicError extends Error {}

async function civicOnce(path: string): Promise<unknown> {
  let res: Response;
  try {
    // On Cloudflare, `cf.cacheTtl` shares one fetch per data center among every visitor polling at once.
    res = await fetch(BASE + path, { cf: { cacheTtl: 20, cacheEverything: true } } as RequestInit);
  } catch {
    throw new CivicError("Couldn't reach civicAPI.");
  }
  if (!res.ok) throw new CivicError(`civicAPI returned ${res.status}.`);
  return res.json();
}

/** civicAPI occasionally answers 503 once under load, so each request gets one retry. */
async function civic(path: string): Promise<unknown> {
  try {
    return await civicOnce(path);
  } catch {
    return civicOnce(path);
  }
}

// civicAPI ignores the date filter but lists newest elections first, so paging stops at the first page
// that reaches an earlier election.
async function racesOfType(type: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let offset = 0; offset < 10 * PAGE; offset += PAGE) {
    const page = (await civic(`race/search?country=US&election_date=${ELECTION_DATE}&type=${encodeURIComponent(type)}&limit=${PAGE}&offset=${offset}`)) as { races?: { election_date?: string }[] };
    const races = page.races ?? [];
    out.push(...races);
    if (races.length < PAGE || races.some((r) => !r.election_date?.startsWith(ELECTION_DATE))) break;
  }
  return out;
}

type Memo<T> = { at: number; value: T };
// Per-isolate memory of the last good answers, so a civicAPI outage shows slightly old results instead of none.
let catalogMemo: Memo<RaceSummary[]> | null = null;
const raceMemo = new Map<number, Memo<RaceDetail>>();

export function resetCivicMemo() {
  catalogMemo = null;
  raceMemo.clear();
}

export type Fetched<T> = T & { fetchedAt: number; stale: boolean };

/** Every tracked race with its statewide (or districtwide) totals. */
export async function fetchCatalog(now: number, ratings: readonly RatedRace[] = []): Promise<Fetched<{ races: RaceSummary[] }>> {
  if (catalogMemo && now - catalogMemo.at < FRESH_MS) return { races: catalogMemo.value, fetchedAt: catalogMemo.at, stale: false };
  try {
    const pages = await Promise.all(TYPES.map(racesOfType));
    // A race can appear under two type searches; keep the first.
    const byId = new Map<number, RaceSummary>();
    for (const raw of pages.flat()) {
      const race = summarize(raw, ratings);
      if (race && !byId.has(race.id)) byId.set(race.id, now < FIRST_POLLS_OPEN ? blankResults(race) : race);
    }
    const races = [...byId.values()];
    catalogMemo = { at: now, value: races };
    return { races, fetchedAt: now, stale: false };
  } catch (err) {
    if (catalogMemo) return { races: catalogMemo.value, fetchedAt: catalogMemo.at, stale: true };
    throw err;
  }
}

/** One tracked race (from the catalog) with county results. */
export async function fetchRace(summary: RaceSummary, now: number, baseline: Readonly<Record<string, number>>): Promise<Fetched<{ race: RaceDetail }>> {
  const memo = raceMemo.get(summary.id);
  if (memo && now - memo.at < FRESH_MS) return { race: memo.value, fetchedAt: memo.at, stale: false };
  try {
    const detail = raceDetail(summary, await civic(`race/${summary.id}`), baseline);
    const race = now < FIRST_POLLS_OPEN ? { ...blankResults(detail), counties: detail.counties.map((c) => ({ ...c, reporting: 0, total: 0, candidates: c.candidates.map((x) => ({ ...x, votes: 0, pct: 0 })) })) } : detail;
    raceMemo.set(summary.id, { at: now, value: race });
    return { race, fetchedAt: now, stale: false };
  } catch (err) {
    if (memo) return { race: memo.value, fetchedAt: memo.at, stale: true };
    throw err;
  }
}
