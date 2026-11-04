import type { Db } from "../auth/accounts";
import { coverageOf, type Coverage } from "./coverage";
import { z } from "zod";
import { applyRatings, blankDetail, blankResults, ELECTION_DATE, isTestData, raceDetail, resultsHidden, summarize, summarizeOther, type Office, type RaceDetail, type RaceSummary, type RatedRace } from "./races";
import { stateFinal } from "./polls";
import { STATE_NAMES } from "./view";

// civicAPI (civicapi.org): free, keyless live results sourced from each Secretary of State. Its terms ask for attribution.
const BASE = "https://civicapi.org/api/v2/";
/**
 * Races per search page. On election night civicAPI answered a 500-race House page with 503 CIVICAPI_OVERLOADED
 * ("the shared response was not ready within its wait budget") while 100-race pages came back.
 */
const PAGE = 100;
/** Pages asked for at once, so a long list doesn't wait on one page after another: the House runs to about 440 races. */
const FIRST_PAGES: Readonly<Record<string, number>> = { "House of Representatives": 5 };
/** The most pages one search will read. */
const MAX_PAGES = 50;
// The race types that hold Senate, House, Governor and statewide-measure races. Others are filtered out in summarize().
const TYPES = ["US Senate", "House of Representatives", "Governor", "Referendum", "Proposition", "Ballot Measure"];
// summarize() keeps only statewide governors and measures, so these are searched for statewide races alone: Referendum
// otherwise lists over a thousand local Nov 3 measures.
const STATEWIDE_ONLY = new Set(["Governor", "Referendum", "Proposition", "Ballot Measure"]);
/**
 * How long a fetched catalog or race is reused before asking civicAPI again: civicAPI's own cache time, so each
 * refresh can bring new numbers. Date-filtered searches keep a refresh to about six small requests.
 */
export const FRESH_MS = 15_000;
/**
 * A page view that can refresh in the background is served a catalog up to this old at once, rather than waiting
 * the several seconds civicAPI takes; the next poll gets the refreshed one. The minutely cron keeps D1's copy within
 * this, with room for a skipped write (WRITE_EVERY_MS) and a slow refresh.
 */
export const SERVE_STALE_MS = 3 * 60_000;
/**
 * How long a page view waits on civicAPI when it has an older catalog to fall back on. Past this it gets that
 * catalog marked stale, and the fetch finishes after the response for the next view.
 */
export const WAIT_MS = 8_000;
/**
 * One civicAPI request is given up after this long, so a hung connection can't hold a response or a refresh. On the
 * afternoon of Nov 3 its searches took 12 to 17 seconds to answer, so a shorter limit threw good answers away.
 */
const REQUEST_TIMEOUT_MS = 25_000;
/**
 * A whole catalog refresh (every race type, every page, with retries) gets this long; race types still unanswered
 * then count as failed. A page view's refresh runs after its response, and Workers end that work 30 seconds later.
 */
export const REFRESH_BUDGET_MS = 28_000;
/**
 * The minutely cron (custom-worker.ts) isn't cut off at 30 seconds, so its refresh gets most of the minute: enough
 * for a 503'd search to be asked again twice. It ends before the next run starts.
 */
export const CRON_REFRESH_BUDGET_MS = 55_000;
/**
 * A fetch still unsettled this long past its budget is presumed cut off (a page view's background work ends 30
 * seconds after its response), so a new one may start.
 */
const STUCK_GRACE_MS = 5_000;

export class CivicError extends Error {}
/** civicAPI has no race with that id: not worth retrying. */
export class CivicNotFound extends CivicError {}

/** How long a request may take: REQUEST_TIMEOUT_MS, or less when a `deadline` (epoch ms) comes first. Throws once it has passed. */
function timeLeft(deadline: number): number {
  const left = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
  if (left <= 0) throw new CivicError("civicAPI refresh ran out of time.");
  return left;
}

async function civicOnce(path: string, deadline: number): Promise<unknown> {
  let res: Response;
  const timeout = timeLeft(deadline);
  try {
    // On Cloudflare, `cf.cacheTtl` shares one fetch per data center among every visitor polling at once. It's kept
    // under civicAPI's own 15s cache, so the edge adds little delay on top of it on election night.
    res = await fetch(BASE + path, { cf: { cacheTtl: 10, cacheEverything: true }, signal: AbortSignal.timeout(timeout) } as RequestInit);
  } catch {
    throw new CivicError("Couldn't reach civicAPI.");
  }
  if (res.status === 404) throw new CivicNotFound("civicAPI has no such race.");
  if (!res.ok) throw new CivicError(`civicAPI returned ${res.status}.`);
  return res.json();
}

const RETRY_DELAYS_MS = [300, 1000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * civicAPI answers 503 now and then under load, so each request is retried twice after a short pause, as long as
 * `deadline` (epoch ms) leaves time for it.
 */
export async function civic(path: string, deadline = Infinity): Promise<unknown> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await civicOnce(path, deadline);
    } catch (err) {
      if (err instanceof CivicNotFound) throw err;
      if (Date.now() + delay >= deadline) throw err;
      await sleep(delay);
    }
  }
  return civicOnce(path, deadline);
}

/** Runs `work` over `items` with at most `limit` in flight, keeping results in order. */
export async function pooled<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

// civicAPI ignores `election_date` but filters on `startDate`/`endDate` (as its own decision page asks), so every page
// holds only Nov 3 races. Should it stop filtering, it lists newest elections first, so paging still stops at the
// first page with no Nov 3 race at all; summarize() keeps only Nov 3 races either way.
async function racesOfType(type: string, deadline: number): Promise<unknown[]> {
  const filter = `startDate=${ELECTION_DATE}&endDate=${ELECTION_DATE}${STATEWIDE_ONLY.has(type) ? "&election_type=Statewide" : ""}`;
  const page = async (n: number) =>
    ((await civic(`race/search?country=US&${filter}&type=${encodeURIComponent(type)}&limit=${PAGE}&offset=${n * PAGE}`, deadline)) as { races?: { election_date?: string }[] }).races ?? [];
  const more = (races: readonly { election_date?: string }[]) => races.length === PAGE && races.some((r) => r.election_date?.startsWith(ELECTION_DATE));
  const first = FIRST_PAGES[type] ?? 1;
  const pages = await Promise.all(Array.from({ length: first }, (_, n) => page(n)));
  // A page past the end comes back short or empty, so only a full last page means there are more.
  const out = pages.flat();
  for (let n = first, last = pages[first - 1]; n < MAX_PAGES && more(last); n++) {
    last = await page(n);
    out.push(...last);
  }
  return out;
}

type Memo<T> = { at: number; value: T };
/**
 * A catalog as of `at`. Races without `missing` were in civicAPI's answer at `at`; missing ones carry `lastSeen`.
 * `fromStore` marks one pieced together from D1's per-race snapshots rather than a single civicAPI answer.
 * `failed` lists the race types whose search failed; their races keep their last numbers, marked missing.
 */
type Stored = Memo<RaceSummary[]> & { fromStore?: true; failed?: string[] };
// Per-isolate memory of the last served catalog, so a civicAPI outage shows slightly old results instead of none.
let catalogMemo: Stored | null = null;
/** The civicAPI fetch under way, so page views and background refreshes arriving together share one. */
let inFlight: { since: number; budget: number; work: Promise<Stored> } | null = null;
/** Whether the fetch under way, if any, has run so far past its budget that it must have been cut off. */
const stuck = (now: number) => !inFlight || now - inFlight.since >= inFlight.budget + STUCK_GRACE_MS;
const raceMemo = new Map<number, Memo<RaceDetail>>();

// D1 keeps each race's latest numbers (midterm_race_snapshots) and every race ever seen (midterm_registry), so an
// isolate that starts during an outage can show results and a race civicAPI leaves out keeps its last numbers.
const WRITE_EVERY_MS = 60_000;
const REGISTRY_EVERY_MS = 60_000;
/** Without a `background` hook, the longest a response waits on D1 writes; slower ones finish (or not) on their own. */
const WRITE_WAIT_MS = 1_000;
let lastWriteAt = 0;
/** Each race's JSON as this isolate last wrote it to (or read it from) D1, so unchanged races aren't rewritten. */
const written = new Map<number, string>();

type Registered = { race_id: number; office: Office; state: string; district: number | null; first_seen: number };
let registryMemo: Memo<Map<number, Registered>> | null = null;

/** Each known race's last numbers, with when civicAPI last included it (as far as this isolate can tell). */
type Known = Map<number, { race: RaceSummary; seen: number }>;

/**
 * Races an operator has retired on purpose (a duplicate listing, say). Nothing else ever removes a race: one
 * civicAPI leaves out is kept with its last numbers and `missing: true`.
 */
export const RETIRED_RACE_IDS: ReadonlySet<number> = new Set<number>([
  // Second listings of Washington's three statewide initiatives (IP26-645, IL26-001, IL26-638), which civicAPI has
  // since deleted (404 on Nov 2); the first listings, 130145, 87525 and 130146, are the ones it counts.
  131486, 131487, 131488,
]);

export function resetCivicMemo() {
  catalogMemo = null;
  inFlight = null;
  raceMemo.clear();
  lastWriteAt = 0;
  written.clear();
  registryMemo = null;
  otherMemo.clear();
  searchMemo.clear();
  areaMemo.clear();
  strayStart = 0;
}

/**
 * `stored` marks a catalog pieced together from D1's snapshots: shown to viewers, but not recorded as an observation.
 * `partial` lists the civicAPI race types that failed in the fetch behind it (see Stored's `failed`).
 */
export type Fetched<T> = T & { fetchedAt: number; stale: boolean; stored?: true; partial?: string[] };

/** D1's stored races, and when the last complete refresh finished with all its numbers stored (null if never). */
type Snapshots = { known: Known; refreshedAt: number | null };

/** When the last complete refresh was stored, or null when it never was or can't be read. */
async function readRefreshedAt(db: Db): Promise<number | null> {
  try {
    return (await db.prepare("SELECT at FROM midterm_catalog_refresh WHERE id = 1").first<{ at: number }>())?.at ?? null;
  } catch (err) {
    console.error("midterms catalog refresh time read failed:", err);
    return null;
  }
}

/** Every race's stored numbers, with `seen` set to when they were written. Null when D1 can't be read. */
async function readRaceSnapshots(db: Db): Promise<Snapshots | null> {
  try {
    const [{ results }, refreshedAt] = await Promise.all([
      db.prepare("SELECT race_id, data, fetched_at FROM midterm_race_snapshots").all<{ race_id: number; data: string; fetched_at: number }>(),
      readRefreshedAt(db),
    ]);
    const known: Known = new Map();
    for (const row of results) {
      known.set(row.race_id, { race: JSON.parse(row.data) as RaceSummary, seen: row.fetched_at });
      written.set(row.race_id, row.data);
    }
    return { known, refreshedAt };
  } catch (err) {
    console.error("midterms race snapshot read failed:", err);
    return null;
  }
}

/** The registry, read at most once a minute per isolate. Null when it has never been read successfully. */
async function registry(db: Db | undefined, now: number): Promise<Map<number, Registered> | null> {
  if (!db || (registryMemo && now - registryMemo.at < REGISTRY_EVERY_MS)) return registryMemo?.value ?? null;
  try {
    const { results } = await db.prepare("SELECT race_id, office, state, district, first_seen FROM midterm_registry").all<Registered>();
    registryMemo = { at: now, value: new Map(results.map((r) => [r.race_id, r])) };
  } catch (err) {
    console.error("midterms registry read failed:", err);
  }
  return registryMemo?.value ?? null;
}

const REGISTER = "INSERT OR IGNORE INTO midterm_registry (race_id, office, state, district, first_seen) VALUES (?, ?, ?, ?, ?)";
// A row only ever moves to a newer fetch, so isolates writing at once can't put older numbers back.
const UPSERT = `INSERT INTO midterm_race_snapshots (race_id, data, fetched_at) VALUES (?, ?, ?)
  ON CONFLICT(race_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at
  WHERE excluded.fetched_at > midterm_race_snapshots.fetched_at`;
const MARK_REFRESHED = `INSERT INTO midterm_catalog_refresh (id, at) VALUES (1, ?)
  ON CONFLICT(id) DO UPDATE SET at = excluded.at WHERE excluded.at > midterm_catalog_refresh.at`;

/**
 * One batch that registers `newcomers` and stores the fetched races whose numbers changed since this isolate last
 * wrote them: at most one batch a minute, unless `urgent` (races D1 hasn't stored). When the refresh was `complete`
 * and its numbers are all stored, its time is recorded after the batch. Null when there's nothing to write.
 */
function saveRaces(db: Db, fetched: readonly RaceSummary[], newcomers: readonly RaceSummary[], now: number, urgent: boolean, complete: boolean): Promise<void> | null {
  const due = urgent || now - lastWriteAt >= WRITE_EVERY_MS;
  const changed = due ? fetched.map((race) => ({ race, json: JSON.stringify(race) })).filter(({ race, json }) => written.get(race.id) !== json) : [];
  const mark = due && complete;
  if (changed.length === 0 && newcomers.length === 0 && !mark) return null;
  if (changed.length > 0) lastWriteAt = now;
  for (const { race, json } of changed) written.set(race.id, json);
  for (const r of newcomers) registryMemo?.value.set(r.id, { race_id: r.id, office: r.office, state: r.state, district: r.district, first_seen: now });
  return (async () => {
    if (changed.length > 0 || newcomers.length > 0) {
      try {
        await db.batch([
          ...newcomers.map((r) => db.prepare(REGISTER).bind(r.id, r.office, r.state, r.district, now)),
          ...changed.map(({ race, json }) => db.prepare(UPSERT).bind(race.id, json, now)),
        ]);
      } catch (err) {
        // Forget them, so the next batch tries again.
        for (const { race } of changed) written.delete(race.id);
        for (const r of newcomers) registryMemo?.value.delete(r.id);
        throw err;
      }
    }
    // Only after the numbers it vouches for are stored.
    if (mark) await db.prepare(MARK_REFRESHED).bind(now).run();
  })();
}

/** Runs D1 writes after the response through `background`, or waits on them for at most WRITE_WAIT_MS. Never throws. */
async function handOff(write: Promise<void>, background?: (work: Promise<unknown>) => void): Promise<void> {
  const work = write.catch((err) => console.error("midterms catalog write failed:", err));
  if (background) background(work);
  else await Promise.race([work, sleep(WRITE_WAIT_MS)]);
}

const knownFrom = (memo: Stored): Known => new Map(memo.value.map((race) => [race.id, { race, seen: race.missing ? (race.lastSeen ?? memo.at) : memo.at }]));

/** Both sets of known races, keeping the more recently seen entry per race. */
function newer(a: Known, b: Known): Known {
  const out: Known = new Map(a);
  for (const [id, entry] of b) if (entry.seen > (out.get(id)?.seen ?? -Infinity)) out.set(id, entry);
  return out;
}

/**
 * What a fresh isolate serves: every stored race, as of the latest write or the last complete refresh, whichever is
 * later. Unchanged races aren't rewritten, so the refresh time is what shows a still count is current.
 */
function fromSnapshots(snapshots: Snapshots | null): Stored | null {
  if (!snapshots || snapshots.known.size === 0) return null;
  const entries = [...snapshots.known.values()];
  const at = Math.max(snapshots.refreshedAt ?? -Infinity, ...entries.map((e) => e.seen));
  return { at, value: entries.map((e) => e.race).filter((r) => !RETIRED_RACE_IDS.has(r.id)), fromStore: true };
}

/** Stand-in for a registered race no snapshot has numbers for. */
function placeholder(r: Registered): RaceSummary {
  const state = STATE_NAMES[r.state] ?? r.state;
  const titles: Record<Office, string> = { senate: `${state} US Senate`, house: `${state} US House ${r.district || "At-Large"}`, governor: `${state} Governor`, measure: `${state} ballot measure` };
  return { id: r.race_id, office: r.office, state: r.state, district: r.district, title: titles[r.office], reporting: 0, total: 0, candidates: [], rating: null, missing: true, lastSeen: r.first_seen };
}

/**
 * Every known race: fresh from `fetched` when listed there, else its last numbers marked missing. A counted race
 * civicAPI answers with no votes at all is treated as left out: on election night it sent PA-1 and PA-8 blank every
 * few minutes, and each blank answer withdrew their calls.
 */
function assemble(fetched: readonly RaceSummary[], known: Known, registered: ReadonlyMap<number, Registered> | null): RaceSummary[] {
  const out = new Map<number, RaceSummary>();
  for (const [id, { race, seen }] of known) out.set(id, { ...race, missing: true, lastSeen: seen });
  for (const r of registered?.values() ?? []) if (!out.has(r.race_id)) out.set(r.race_id, placeholder(r));
  for (const race of fetched) if (race.total > 0 || !(known.get(race.id)?.race.total)) out.set(race.id, race);
  return [...out.values()].filter((r) => !RETIRED_RACE_IDS.has(r.id));
}

/** e.g. "house 21, governor 1", or null when nothing is missing. */
function missingByOffice(races: readonly RaceSummary[]): string | null {
  const counts = new Map<string, number>();
  for (const r of races) if (r.missing) counts.set(r.office, (counts.get(r.office) ?? 0) + 1);
  return counts.size > 0 ? [...counts].map(([office, n]) => `${office} ${n}`).join(", ") : null;
}

/**
 * Every race of each type civicAPI answered for, the types it didn't, and the first error when none answered. One
 * failed type doesn't discard the others. Searches end by `deadline` (epoch ms).
 */
async function fetchRaces(now: number, deadline: number): Promise<{ races: RaceSummary[]; failed: string[]; err?: unknown }> {
  // All six searches at once. On Nov 3 civicAPI took 12 to 17 seconds per search and answered about a third with a
  // 503 whether asked one at a time or all together, so two at a time left no room in the budget to ask again.
  const pages = await Promise.all(
    TYPES.map(async (type): Promise<{ races: unknown[] } | { err: unknown }> => {
      try {
        return { races: await racesOfType(type, deadline) };
      } catch (err) {
        return { err };
      }
    }),
  );
  const failed = TYPES.filter((_, i) => "err" in pages[i]);
  if (failed.length === TYPES.length) return { races: [], failed, err: (pages[0] as { err: unknown }).err };
  // A race can appear under two type searches; keep the first.
  const byId = new Map<number, RaceSummary>();
  for (const page of pages) {
    for (const raw of "races" in page ? page.races : []) {
      const race = summarize(raw, [], now);
      if (race && !byId.has(race.id)) byId.set(race.id, resultsHidden(race.state, now, isTestData(raw)) ? blankResults(race) : race);
    }
  }
  return { races: [...byId.values()], failed };
}

/** The race type a race of each office is searched under, for summarizing a race fetched by id. */
const TYPE_OF: Readonly<Record<Exclude<Office, "measure">, string>> = { senate: "US Senate", house: "House of Representatives", governor: "Governor" };
const OFFICE_OF_TYPE = new Map(Object.entries(TYPE_OF).map(([office, type]) => [type, office as Office]));
/**
 * Time kept back from the searches for asking a failed search's races one by one. civicAPI's searches took 18 to 40
 * seconds on election night while a single race came back in about 1.5.
 */
const BY_RACE_RESERVE_MS = 12_000;
/** Races asked for at once when a search failed. */
const BY_RACE_LANES = 16;

/**
 * The races of the failed searches, from civicAPI's race endpoint one at a time, where every poll in the state has
 * closed (elsewhere there's nothing to count yet). Rated races go first, then those counting, so the ones that matter
 * come back before `deadline`. A race that fails stays out, keeping its last numbers.
 */
async function fetchByRace(failed: readonly string[], known: Known, listed: ReadonlySet<number>, now: number, deadline: number): Promise<RaceSummary[]> {
  const offices = new Set(failed.flatMap((type) => OFFICE_OF_TYPE.get(type) ?? []));
  const rank = (r: RaceSummary) => (r.rating ? 0 : r.total > 0 ? 1 : 2);
  const due = [...known.values()]
    .map((k) => k.race)
    .filter((r) => offices.has(r.office) && !listed.has(r.id) && (stateFinal(r.state) ?? Infinity) <= now)
    .sort((a, b) => rank(a) - rank(b));
  const found = await pooled(due, BY_RACE_LANES, async (r): Promise<RaceSummary | null> => {
    if (Date.now() >= deadline) return null;
    try {
      // One try each: with hundreds to ask for, a retry would hold a lane another race could use.
      const raw = (await civicOnce(`race/${r.id}`, deadline)) as Record<string, unknown>;
      if (raw.province !== r.state) return null;
      const race = summarize({ election_type: "Statewide", ...raw, id: r.id, type: TYPE_OF[r.office as Exclude<Office, "measure">] }, [], now);
      return race && (resultsHidden(race.state, now, isTestData(raw)) ? blankResults(race) : race);
    } catch {
      return null;
    }
  });
  return found.filter((r): r is RaceSummary => r !== null);
}

/** At most this many strays are fetched one by one per refresh, so a search gone wrong can't fan out to hundreds. */
const MAX_STRAYS = 12;
/** All strays together get this long; any still unanswered stay missing with their last numbers. */
const STRAYS_BUDGET_MS = 8_000;
/** Where the next refresh's strays start, so that past MAX_STRAYS each one still gets its turn. */
let strayStart = 0;

/**
 * Registered measures the searches have stopped listing but civicAPI still answers for by id: on Nov 2 it relabeled
 * Washington's three statewide initiatives "Local" with no race type. Each is summarized as the statewide measure it
 * was registered as. One civicAPI no longer has (404) or that fails is left out, so it stays missing.
 */
async function fetchStrays(searched: readonly RaceSummary[], registered: ReadonlyMap<number, Registered> | null, now: number): Promise<RaceSummary[]> {
  const listed = new Set(searched.map((r) => r.id));
  const all = [...(registered?.values() ?? [])].filter((r) => r.office === "measure" && !listed.has(r.race_id) && !RETIRED_RACE_IDS.has(r.race_id)).sort((a, b) => a.race_id - b.race_id);
  if (all.length === 0) return [];
  const start = strayStart % all.length;
  const strays = [...all.slice(start), ...all.slice(0, start)].slice(0, MAX_STRAYS);
  strayStart = start + strays.length;
  const deadline = Date.now() + STRAYS_BUDGET_MS;
  const found = await pooled(strays, 3, async (r): Promise<RaceSummary | null> => {
    try {
      const raw = (await civic(`race/${r.race_id}`, deadline)) as Record<string, unknown>;
      if (raw.province !== r.state) return null;
      const race = summarize({ ...raw, id: r.race_id, type: "Referendum", election_type: "Statewide" }, [], now);
      return race && (resultsHidden(race.state, now, isTestData(raw)) ? blankResults(race) : race);
    } catch {
      return null;
    }
  });
  return found.filter((r): r is RaceSummary => r !== null);
}

const served = (memo: Stored, ratings: readonly RatedRace[], stale: boolean) => ({
  races: applyRatings(memo.value, ratings),
  coverage: coverageOf(memo.value),
  fetchedAt: memo.at,
  stale,
  ...(memo.fromStore ? { stored: true as const } : {}),
  ...(memo.failed?.length ? { partial: memo.failed } : {}),
});

/**
 * Every tracked race with its statewide (or districtwide) totals. Every race ever seen (in this isolate, in D1's
 * race snapshots or in the registry) stays listed; one civicAPI leaves out keeps its last numbers with `missing: true`.
 * When civicAPI doesn't answer at all, the last catalog (from memory, else from `db`) is served marked stale.
 * `background` lets the D1 writes finish after the response. With `serveStale` as well, a catalog under
 * SERVE_STALE_MS old (this isolate's, or D1's on a fresh isolate) is served at once and refreshed after the response,
 * and an older one is served marked stale when civicAPI takes longer than WAIT_MS. `budget` caps a civicAPI refresh
 * this call starts (CRON_REFRESH_BUDGET_MS for the cron).
 */
export async function fetchCatalog(
  now: number,
  ratings: readonly RatedRace[] = [],
  db?: Db,
  background?: (work: Promise<unknown>) => void,
  serveStale = false,
  budget = REFRESH_BUDGET_MS,
): Promise<Fetched<{ races: RaceSummary[]; coverage: Coverage }>> {
  // The memo holds races without ratings; each caller's ratings are attached on the way out.
  if (catalogMemo && now - catalogMemo.at < FRESH_MS) return served(catalogMemo, ratings, false);
  const revalidate = serveStale && background ? background : null;
  if (revalidate && catalogMemo && now - catalogMemo.at < SERVE_STALE_MS) return refreshAfter(catalogMemo, ratings, now, revalidate, budget, db);
  // An isolate left idle past SERVE_STALE_MS holds an old catalog, while the cron keeps D1's newer: serve D1's at
  // once, as a fresh isolate does, rather than wait up to WAIT_MS on civicAPI.
  if (revalidate && catalogMemo && db) {
    const stored = fromSnapshots(await readRaceSnapshots(db));
    if (stored && catalogMemo && stored.at > catalogMemo.at && now - stored.at < SERVE_STALE_MS) {
      catalogMemo = stored;
      return refreshAfter(stored, ratings, now, revalidate, budget, db);
    }
  }
  // A fresh isolate has no memo, so D1 stands in for it; it's read while civicAPI is asked.
  const warm = catalogMemo;
  const snapshots = warm || !db ? Promise.resolve(null) : readRaceSnapshots(db);
  if (revalidate && !warm) {
    const stored = fromSnapshots(await snapshots);
    if (stored && now - stored.at < SERVE_STALE_MS) {
      catalogMemo = stored;
      return refreshAfter(stored, ratings, now, revalidate, budget, db);
    }
  }
  const outcome = latest(now, budget, db, background, warm, snapshots).then(
    (memo) => ({ memo }),
    (err: unknown) => ({ err }),
  );
  // With an older catalog to fall back on, a page view waits only so long for civicAPI.
  const fallback = revalidate ? (warm ?? fromSnapshots(await snapshots)) : null;
  const result = fallback ? await Promise.race([outcome, sleep(WAIT_MS).then(() => null)]) : await outcome;
  if (result === null) {
    revalidate!(outcome);
    return served(fallback!, ratings, true);
  }
  if ("memo" in result) return served(result.memo, ratings, false);
  const last = warm ?? fromSnapshots(await snapshots);
  if (!last) throw result.err;
  catalogMemo = { ...last, value: last.value.filter((r) => !RETIRED_RACE_IDS.has(r.id)) };
  return served(catalogMemo, ratings, true);
}

/** The civicAPI fetch under way, or a new one when there's none (or the last one looks cut off). */
function latest(now: number, budget: number, db: Db | undefined, background: ((work: Promise<unknown>) => void) | undefined, warm: Stored | null, snapshots: Promise<Snapshots | null>): Promise<Stored> {
  if (inFlight && !stuck(now)) return inFlight.work;
  const work: Promise<Stored> = load(now, budget, db, background, warm, snapshots).finally(() => {
    if (inFlight?.work === work) inFlight = null;
  });
  inFlight = { since: now, budget, work };
  return work;
}

/** Asks civicAPI for every race, keeps the ones it left out, saves the result to memory and D1. Throws on CivicError. */
async function load(now: number, budget: number, db: Db | undefined, background: ((work: Promise<unknown>) => void) | undefined, warm: Stored | null, snapshots: Promise<Snapshots | null>): Promise<Stored> {
  const registeredRaces = registry(db, now);
  const deadline = Date.now() + budget;
  const { races: searched, failed, err } = await fetchRaces(now, deadline - BY_RACE_RESERVE_MS);
  const registered = await registeredRaces;
  let known = warm ? knownFrom(warm) : ((await snapshots)?.known ?? new Map());
  // A failed search's races are asked for one by one. A partial answer leaves out every race of the failed types, so
  // strays are only looked for in a complete one.
  const byRace = failed.length ? await fetchByRace(failed, known, new Set(searched.map((r) => r.id)), now, deadline) : [];
  if (failed.length) console.error(`midterms: civicAPI failed for ${failed.join(", ")}; ${byRace.length} of those races refreshed one by one, the rest keep their last known numbers`);
  if (err && byRace.length === 0) throw err;
  const fetched = failed.length ? [...searched, ...byRace] : [...searched, ...(await fetchStrays(searched, registered, now))];
  const listed = new Set(fetched.map((r) => r.id));
  // Registered races this isolate has no numbers for: another isolate saw them, so D1 may hold their numbers.
  if (db && warm && [...(registered?.keys() ?? [])].some((id) => !listed.has(id) && !known.has(id))) {
    const stored = await readRaceSnapshots(db);
    if (stored) known = newer(known, stored.known);
  }
  const races = assemble(fetched, known, registered);
  const missing = missingByOffice(races);
  if (missing) console.error(`midterms: civicAPI left out races (${missing}); showing their last known numbers`);
  const memo: Stored = { at: now, value: races, ...(failed.length && { failed }) };
  // A slower fetch that started earlier never replaces a newer catalog.
  if (!catalogMemo || catalogMemo.at <= now) catalogMemo = memo;
  if (db) {
    const newcomers = registered ? fetched.filter((r) => !registered.has(r.id)) : [];
    const write = saveRaces(db, fetched, newcomers, now, fetched.some((r) => !known.has(r.id)), failed.length === 0);
    if (write) await handOff(write, background);
  }
  return memo;
}

/** Serves `memo` now and starts one refresh from civicAPI after the response, unless one is already running. */
function refreshAfter(memo: Stored, ratings: readonly RatedRace[], now: number, background: (work: Promise<unknown>) => void, budget: number, db?: Db) {
  if (stuck(now)) {
    background(latest(now, budget, db, background, memo, Promise.resolve(null)).catch((err) => console.error("midterms catalog refresh failed:", err)));
  }
  return served(memo, ratings, false);
}

/** One tracked race (from the catalog) with county results. */
/**
 * How long a race page waits on civicAPI for one race (retries included) before it falls back to the last copy. On
 * election night civicAPI answered a race in about 1.5 seconds while its searches were overloaded; without a limit a
 * page waited up to 50 seconds for a 503.
 */
const RACE_WAIT_MS = 6_000;
/** How long the last good copy of a race is kept in the data center's shared cache, to stand in when civicAPI fails. */
const RACE_KEEP_S = 15 * 60;
const keptUrl = (key: string) => `https://ballotwise.internal/civic/${encodeURIComponent(key)}`;
/** The Workers cache shared by every isolate in the data center; absent outside Workers (tests, scripts). */
const edgeCache = (): Cache | null => (typeof caches === "undefined" ? null : (caches as unknown as { default?: Cache }).default ?? null);

/** Keeps a good civicAPI answer (`key` names it) in the data center's shared cache, to stand in when civicAPI fails. */
async function keep(key: string, at: number, value: unknown): Promise<void> {
  try {
    await edgeCache()?.put(keptUrl(key), Response.json({ at, value }, { headers: { "cache-control": `max-age=${RACE_KEEP_S}` } }));
  } catch {
    // A cache that won't take it only loses the fallback.
  }
}

/** The newest answer any server here kept under `key` (see keep), or null. */
async function kept<T>(key: string): Promise<Memo<T> | null> {
  try {
    const hit = await edgeCache()?.match(keptUrl(key));
    const found = hit ? ((await hit.json()) as { at?: unknown; value?: unknown }) : null;
    return found && typeof found.at === "number" && found.value && typeof found.value === "object" ? { at: found.at, value: found.value as T } : null;
  } catch {
    return null;
  }
}

export async function fetchRace(summary: RaceSummary, now: number, baseline: Readonly<Record<string, readonly [number, number, number]>>): Promise<Fetched<{ race: RaceDetail }>> {
  const memo = raceMemo.get(summary.id);
  if (memo && now - memo.at < FRESH_MS) return { race: memo.value, fetchedAt: memo.at, stale: false };
  try {
    const input = await civic(`race/${summary.id}`, Date.now() + RACE_WAIT_MS);
    const detail = raceDetail(summary, input, baseline, now);
    const race = resultsHidden(summary.state, now, isTestData(input)) ? blankDetail(detail) : detail;
    raceMemo.set(summary.id, { at: now, value: race });
    await keep(`race/${summary.id}`, now, race);
    return { race, fetchedAt: now, stale: false };
  } catch (err) {
    // This server's own copy, else the newest any server here kept: a page shows slightly old counties, not an error.
    const last = memo ?? (await kept<RaceDetail>(`race/${summary.id}`));
    if (last) return { race: last.value, fetchedAt: last.at, stale: true };
    throw err;
  }
}

// ---------- Any race (search) ----------

/** Races fetched for the search path, by id. Kept apart from the tracked catalog so they never reach the overview. */
const otherMemo = new Map<number, { at: number; value: RaceDetail | null }>();
/** Searches by query, briefly, so typing and repeat searches don't each reach civicAPI. */
const searchMemo = new Map<string, { at: number; value: FoundRace[] }>();
/** civicAPI's answers to the "Near you" tab's place searches, by query. They carry live numbers, so they're fresh for FRESH_MS. */
const areaMemo = new Map<string, { at: number; value: unknown }>();
/** Most entries either memo keeps; the oldest goes first. */
const MEMO_CAP = 300;
/** An id civicAPI doesn't know is remembered this long, so a crawler walking ids can't make us ask again and again. */
const MISSING_MS = 5 * 60_000;
const SEARCH_MS = 5 * 60_000;

function remember<K, V>(memo: Map<K, V>, key: K, value: V) {
  memo.delete(key);
  memo.set(key, value);
  if (memo.size > MEMO_CAP) memo.delete(memo.keys().next().value as K);
}

/** Puts each candidate's civicAPI color back on the race and its counties, which raceDetail rebuilds without it. */
export function withColors(detail: RaceDetail, colors: ReadonlyMap<string, string | undefined>): RaceDetail {
  const paint = <T extends { name: string }>(c: T): T => (colors.get(c.name) ? { ...c, color: colors.get(c.name) } : c);
  return { ...detail, candidates: detail.candidates.map(paint), counties: detail.counties.map((c) => ({ ...c, candidates: c.candidates.map(paint) })) };
}

/**
 * Any US race on civicAPI by id, for races outside the tracked offices: a mayor, a school board seat, a local
 * question. Null when civicAPI has no such race or it isn't a US race. Fresh for FRESH_MS like tracked races;
 * on a civicAPI failure the last good copy is served marked stale.
 */
export async function fetchOtherRace(id: number, now: number, baseline: Readonly<Record<string, readonly [number, number, number]>>): Promise<Fetched<{ race: RaceDetail }> | null> {
  const memo = otherMemo.get(id);
  if (memo && now - memo.at < (memo.value ? FRESH_MS : MISSING_MS)) return memo.value ? { race: memo.value, fetchedAt: memo.at, stale: false } : null;
  let input: unknown;
  try {
    input = await civic(`race/${id}`);
  } catch (err) {
    if (err instanceof CivicNotFound) {
      remember(otherMemo, id, { at: now, value: null });
      return null;
    }
    if (memo?.value) return { race: memo.value, fetchedAt: memo.at, stale: true };
    throw err;
  }
  const summary = summarizeOther({ ...(input as object), id }, now);
  if (!summary) {
    remember(otherMemo, id, { at: now, value: null });
    return null;
  }
  const detail = withColors(raceDetail(summary, input, baseline, now), new Map(summary.candidates.map((c) => [c.name, c.color])));
  // Like tracked races, a Nov 3 race shows no numbers before its state's polls close: civicAPI posts test counts beforehand.
  const race = isTestData(input) || (summary.local?.date === ELECTION_DATE && resultsHidden(summary.state, now)) ? blankDetail(detail) : detail;
  remember(otherMemo, id, { at: now, value: race });
  return { race, fetchedAt: now, stale: false };
}

/** One search result: enough to list a race and link to its page. */
/** `url` is set on a race our race page doesn't know (Decision Desk HQ's local races), which opens there instead. */
export type FoundRace = { id: number; title: string; state: string; type: string; date: string; kind: "local" | "statewide" | "other"; url?: string };

const searchAnswer = z.object({
  races: z
    .array(z.object({ id: z.number().int().positive(), type: z.string().nullish(), country: z.string().nullish(), province: z.string().nullish(), election_name: z.string(), election_date: z.string(), election_type: z.string().nullish() }).passthrough())
    .default([]),
});
/** Most results a search returns. */
export const SEARCH_LIMIT = 25;

/**
 * US races matching `query` on civicAPI, for "find any race". civicAPI ignores its date filter on text searches,
 * so this keeps races from 2026 on itself: Nov 3 races first, then the rest newest first.
 */
export function searchResults(answer: unknown): FoundRace[] {
  const parsed = searchAnswer.safeParse(answer);
  if (!parsed.success) return [];
  return parsed.data.races
    .filter((r) => (!r.country || r.country === "US") && r.election_date.slice(0, 4) >= "2026")
    .map((r) => ({
      id: r.id,
      title: r.election_name.replace(/\s+/g, " ").trim(),
      state: r.province ?? "",
      type: r.type ?? "",
      date: r.election_date.slice(0, 10),
      kind: (r.election_type === "Local" ? "local" : r.election_type === "Statewide" ? "statewide" : "other") as FoundRace["kind"],
    }))
    .sort((a, b) => Number(b.date === ELECTION_DATE) - Number(a.date === ELECTION_DATE) || b.date.localeCompare(a.date))
    .slice(0, SEARCH_LIMIT);
}

export async function searchRaces(query: string, now: number): Promise<FoundRace[]> {
  const key = query.toLowerCase();
  const memo = searchMemo.get(key);
  if (memo && now - memo.at < SEARCH_MS) return memo.value;
  const value = searchResults(await civic(`race/search?query=${encodeURIComponent(query)}&country=US&limit=100`));
  remember(searchMemo, key, { at: now, value });
  return value;
}

/**
 * civicAPI's Nov 3 races matching `query`, with their numbers, for the races near an address. Fresh for FRESH_MS; on a
 * civicAPI failure the last answer is used, marked stale. Like race pages, no numbers show before the state's polls close.
 */
/** How long one place search waits on civicAPI, retries included, before falling back to the last good answer. */
const SEARCH_WAIT_MS = 8_000;

export async function searchLive(query: string, now: number): Promise<{ races: RaceSummary[]; stale: boolean }> {
  const key = query.toLowerCase();
  const memo = areaMemo.get(key);
  let answer = memo?.value;
  let stale = false;
  if (!memo || now - memo.at >= FRESH_MS) {
    try {
      // A page waits on several of these at once (Near you), so each gets SEARCH_WAIT_MS, not civicAPI's whole timeout.
      answer = await civic(`race/search?query=${encodeURIComponent(query)}&country=US&limit=100`, Date.now() + SEARCH_WAIT_MS);
      remember(areaMemo, key, { at: now, value: answer });
      await keep(`search/${key}`, now, answer);
    } catch (err) {
      // This server's own copy, else the newest any server here kept, marked stale.
      const last = memo ?? (await kept<unknown>(`search/${key}`));
      if (!last) throw err;
      answer = last.value;
      stale = true;
    }
  }
  const found = (answer as { races?: unknown } | null)?.races;
  const races = (Array.isArray(found) ? found : []).flatMap((input) => {
    const race = summarizeOther(input, now);
    if (race?.local?.date !== ELECTION_DATE) return [];
    return [resultsHidden(race.state, now, isTestData(input)) ? blankResults(race) : race];
  });
  return { races, stale };
}
