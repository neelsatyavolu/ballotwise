import type { Db } from "../auth/accounts";
import { coverageOf, type Coverage } from "./coverage";
import { z } from "zod";
import { applyRatings, blankResults, ELECTION_DATE, FIRST_POLLS_OPEN, raceDetail, summarize, summarizeOther, type Office, type RaceDetail, type RaceSummary, type RatedRace } from "./races";
import { STATE_NAMES } from "./view";

// civicAPI (civicapi.org): free, keyless live results sourced from each Secretary of State. Its terms ask for attribution.
const BASE = "https://civicapi.org/api/v2/";
const PAGE = 500;
// The race types that hold Senate, House, Governor and statewide-measure races. Others are filtered out in summarize().
const TYPES = ["US Senate", "House of Representatives", "Governor", "Referendum", "Proposition", "Ballot Measure"];
// About 36 races each this year, ahead of years of older ones: a 100-race page holds them all and comes back in
// half the time of a 500-race one.
const SMALL_PAGE: Record<string, number> = { "US Senate": 100, Governor: 100 };
/** How long a fetched catalog or race is reused before asking civicAPI again. civicAPI itself caches for 15s. */
export const FRESH_MS = 30_000;
/**
 * A page view that can refresh in the background is served a catalog up to this old at once, rather than waiting
 * the several seconds civicAPI takes; the next poll gets the refreshed one.
 */
export const SERVE_STALE_MS = 2 * 60_000;
/**
 * How long a page view waits on civicAPI when it has an older catalog to fall back on. Past this it gets that
 * catalog marked stale, and the fetch finishes after the response for the next view.
 */
export const WAIT_MS = 8_000;
/** One civicAPI request is given up after this long, so a hung connection can't hold a response or a refresh. */
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * A whole catalog refresh (every race type, every page, with retries) gets this long; race types still unanswered
 * then count as failed. Under STUCK_MS, so a refresh ends before another is allowed to start beside it.
 */
const REFRESH_BUDGET_MS = 40_000;
/**
 * A fetch still unsettled after this long is presumed cut off (Workers end background work 30 seconds after the
 * response), so a new one may start.
 */
const STUCK_MS = 45_000;

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

// civicAPI ignores the date filter but lists newest elections first. Its order isn't strict (a later runoff or an
// earlier special can sit among the Nov 3 races), so paging goes on past mixed pages and stops at the first page
// with no Nov 3 race at all; summarize() keeps only Nov 3 races.
async function racesOfType(type: string, deadline: number): Promise<unknown[]> {
  const out: unknown[] = [];
  const size = SMALL_PAGE[type] ?? PAGE;
  for (let offset = 0; offset < 10 * PAGE; offset += size) {
    const page = (await civic(`race/search?country=US&election_date=${ELECTION_DATE}&type=${encodeURIComponent(type)}&limit=${size}&offset=${offset}`, deadline)) as { races?: { election_date?: string }[] };
    const races = page.races ?? [];
    out.push(...races);
    if (races.length < size || !races.some((r) => r.election_date?.startsWith(ELECTION_DATE))) break;
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
let inFlight: { since: number; work: Promise<Stored> } | null = null;
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
export const RETIRED_RACE_IDS: ReadonlySet<number> = new Set<number>();

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
}

/**
 * `stored` marks a catalog pieced together from D1's snapshots: shown to viewers, but not recorded as an observation.
 * `partial` lists the civicAPI race types that failed in the fetch behind it (see Stored's `failed`).
 */
export type Fetched<T> = T & { fetchedAt: number; stale: boolean; stored?: true; partial?: string[] };

/** Every race's stored numbers, with `seen` set to when they were written. Null when D1 can't be read. */
async function readRaceSnapshots(db: Db): Promise<Known | null> {
  try {
    const { results } = await db.prepare("SELECT race_id, data, fetched_at FROM midterm_race_snapshots").all<{ race_id: number; data: string; fetched_at: number }>();
    const known: Known = new Map();
    for (const row of results) {
      known.set(row.race_id, { race: JSON.parse(row.data) as RaceSummary, seen: row.fetched_at });
      written.set(row.race_id, row.data);
    }
    return known;
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

/**
 * One batch that registers `newcomers` and stores the fetched races whose numbers changed since this isolate last
 * wrote them: at most one batch a minute, unless `urgent` (races D1 hasn't stored). Null when there's nothing to write.
 */
function saveRaces(db: Db, fetched: readonly RaceSummary[], newcomers: readonly RaceSummary[], now: number, urgent: boolean): Promise<void> | null {
  const due = urgent || now - lastWriteAt >= WRITE_EVERY_MS;
  const changed = due ? fetched.map((race) => ({ race, json: JSON.stringify(race) })).filter(({ race, json }) => written.get(race.id) !== json) : [];
  if (changed.length === 0 && newcomers.length === 0) return null;
  if (changed.length > 0) lastWriteAt = now;
  for (const { race, json } of changed) written.set(race.id, json);
  for (const r of newcomers) registryMemo?.value.set(r.id, { race_id: r.id, office: r.office, state: r.state, district: r.district, first_seen: now });
  return (async () => {
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

/** What a fresh isolate serves during an outage: every stored race, as of the latest write. */
function fromSnapshots(known: Known | null): Stored | null {
  if (!known || known.size === 0) return null;
  const entries = [...known.values()];
  return { at: Math.max(...entries.map((e) => e.seen)), value: entries.map((e) => e.race).filter((r) => !RETIRED_RACE_IDS.has(r.id)), fromStore: true };
}

/** Stand-in for a registered race no snapshot has numbers for. */
function placeholder(r: Registered): RaceSummary {
  const state = STATE_NAMES[r.state] ?? r.state;
  const titles: Record<Office, string> = { senate: `${state} US Senate`, house: `${state} US House ${r.district || "At-Large"}`, governor: `${state} Governor`, measure: `${state} ballot measure` };
  return { id: r.race_id, office: r.office, state: r.state, district: r.district, title: titles[r.office], reporting: 0, total: 0, candidates: [], rating: null, missing: true, lastSeen: r.first_seen };
}

/** Every known race: fresh from `fetched` when listed there, else its last numbers marked missing. */
function assemble(fetched: readonly RaceSummary[], known: Known, registered: ReadonlyMap<number, Registered> | null): RaceSummary[] {
  const out = new Map<number, RaceSummary>();
  for (const [id, { race, seen }] of known) out.set(id, { ...race, missing: true, lastSeen: seen });
  for (const r of registered?.values() ?? []) if (!out.has(r.race_id)) out.set(r.race_id, placeholder(r));
  for (const race of fetched) out.set(race.id, race);
  return [...out.values()].filter((r) => !RETIRED_RACE_IDS.has(r.id));
}

/** e.g. "house 21, governor 1", or null when nothing is missing. */
function missingByOffice(races: readonly RaceSummary[]): string | null {
  const counts = new Map<string, number>();
  for (const r of races) if (r.missing) counts.set(r.office, (counts.get(r.office) ?? 0) + 1);
  return counts.size > 0 ? [...counts].map(([office, n]) => `${office} ${n}`).join(", ") : null;
}

/**
 * Every race of each type civicAPI answered for, and the types it didn't. One failed type doesn't discard the
 * others; only when every type fails does this throw.
 */
async function fetchRaces(now: number): Promise<{ races: RaceSummary[]; failed: string[] }> {
  const deadline = Date.now() + REFRESH_BUDGET_MS;
  const tally = { ok: 0, failed: 0 };
  // Settles once a type has answered or two have failed: whether civicAPI is up is known by then.
  let decide = () => {};
  const decided = new Promise<void>((resolve) => (decide = resolve));
  // Two searches at a time: civicAPI answers 503 more often when hit with all six at once. Once two have failed
  // with none answered, civicAPI is down, so the rest aren't tried.
  const pages = await pooled(TYPES, 2, async (type): Promise<{ races: unknown[] } | { err: unknown }> => {
    if (tally.ok === 0 && tally.failed > 0) await decided;
    if (tally.ok === 0 && tally.failed >= 2) return { err: new CivicError("civicAPI looks down.") };
    try {
      const races = await racesOfType(type, deadline);
      tally.ok += 1;
      decide();
      return { races };
    } catch (err) {
      tally.failed += 1;
      if (tally.failed >= 2) decide();
      return { err };
    }
  });
  const failed = TYPES.filter((_, i) => "err" in pages[i]);
  if (failed.length === TYPES.length) throw (pages[0] as { err: unknown }).err;
  // A race can appear under two type searches; keep the first.
  const byId = new Map<number, RaceSummary>();
  for (const page of pages) {
    for (const raw of "races" in page ? page.races : []) {
      const race = summarize(raw, [], now);
      if (race && !byId.has(race.id)) byId.set(race.id, now < FIRST_POLLS_OPEN ? blankResults(race) : race);
    }
  }
  return { races: [...byId.values()], failed };
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
 * and an older one is served marked stale when civicAPI takes longer than WAIT_MS.
 */
export async function fetchCatalog(
  now: number,
  ratings: readonly RatedRace[] = [],
  db?: Db,
  background?: (work: Promise<unknown>) => void,
  serveStale = false,
): Promise<Fetched<{ races: RaceSummary[]; coverage: Coverage }>> {
  // The memo holds races without ratings; each caller's ratings are attached on the way out.
  if (catalogMemo && now - catalogMemo.at < FRESH_MS) return served(catalogMemo, ratings, false);
  const revalidate = serveStale && background ? background : null;
  if (revalidate && catalogMemo && now - catalogMemo.at < SERVE_STALE_MS) return refreshAfter(catalogMemo, ratings, now, revalidate, db);
  // A fresh isolate has no memo, so D1 stands in for it; it's read while civicAPI is asked.
  const warm = catalogMemo;
  const snapshots = warm || !db ? Promise.resolve(null) : readRaceSnapshots(db);
  if (revalidate && !warm) {
    const stored = fromSnapshots(await snapshots);
    if (stored && now - stored.at < SERVE_STALE_MS) {
      catalogMemo = stored;
      return refreshAfter(stored, ratings, now, revalidate, db);
    }
  }
  const outcome = latest(now, db, background, warm, snapshots).then(
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
function latest(now: number, db: Db | undefined, background: ((work: Promise<unknown>) => void) | undefined, warm: Stored | null, snapshots: Promise<Known | null>): Promise<Stored> {
  if (inFlight && now - inFlight.since < STUCK_MS) return inFlight.work;
  const work: Promise<Stored> = load(now, db, background, warm, snapshots).finally(() => {
    if (inFlight?.work === work) inFlight = null;
  });
  inFlight = { since: now, work };
  return work;
}

/** Asks civicAPI for every race, keeps the ones it left out, saves the result to memory and D1. Throws on CivicError. */
async function load(now: number, db: Db | undefined, background: ((work: Promise<unknown>) => void) | undefined, warm: Stored | null, snapshots: Promise<Known | null>): Promise<Stored> {
  const registeredRaces = registry(db, now);
  const { races: fetched, failed } = await fetchRaces(now);
  if (failed.length) console.error(`midterms: civicAPI failed for ${failed.join(", ")}; those races keep their last known numbers`);
  let known = warm ? knownFrom(warm) : ((await snapshots) ?? new Map());
  const registered = await registeredRaces;
  const listed = new Set(fetched.map((r) => r.id));
  // Registered races this isolate has no numbers for: another isolate saw them, so D1 may hold their numbers.
  if (db && warm && [...(registered?.keys() ?? [])].some((id) => !listed.has(id) && !known.has(id))) {
    const stored = await readRaceSnapshots(db);
    if (stored) known = newer(known, stored);
  }
  const races = assemble(fetched, known, registered);
  const missing = missingByOffice(races);
  if (missing) console.error(`midterms: civicAPI left out races (${missing}); showing their last known numbers`);
  const memo: Stored = { at: now, value: races, ...(failed.length && { failed }) };
  // A slower fetch that started earlier never replaces a newer catalog.
  if (!catalogMemo || catalogMemo.at <= now) catalogMemo = memo;
  if (db) {
    const newcomers = registered ? fetched.filter((r) => !registered.has(r.id)) : [];
    const write = saveRaces(db, fetched, newcomers, now, fetched.some((r) => !known.has(r.id)));
    if (write) await handOff(write, background);
  }
  return memo;
}

/** Serves `memo` now and starts one refresh from civicAPI after the response, unless one is already running. */
function refreshAfter(memo: Stored, ratings: readonly RatedRace[], now: number, background: (work: Promise<unknown>) => void, db?: Db) {
  if (!inFlight || now - inFlight.since >= STUCK_MS) {
    background(latest(now, db, background, memo, Promise.resolve(null)).catch((err) => console.error("midterms catalog refresh failed:", err)));
  }
  return served(memo, ratings, false);
}

/** One tracked race (from the catalog) with county results. */
export async function fetchRace(summary: RaceSummary, now: number, baseline: Readonly<Record<string, readonly [number, number, number]>>): Promise<Fetched<{ race: RaceDetail }>> {
  const memo = raceMemo.get(summary.id);
  if (memo && now - memo.at < FRESH_MS) return { race: memo.value, fetchedAt: memo.at, stale: false };
  try {
    const detail = raceDetail(summary, await civic(`race/${summary.id}`), baseline, now);
    const race = now < FIRST_POLLS_OPEN ? { ...blankResults(detail), counties: detail.counties.map((c) => ({ ...c, reporting: 0, total: 0, candidates: c.candidates.map((x) => ({ ...x, votes: 0, pct: 0 })) })) } : detail;
    raceMemo.set(summary.id, { at: now, value: race });
    return { race, fetchedAt: now, stale: false };
  } catch (err) {
    if (memo) return { race: memo.value, fetchedAt: memo.at, stale: true };
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
function withColors(detail: RaceDetail, colors: ReadonlyMap<string, string | undefined>): RaceDetail {
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
  // Like tracked races, a Nov 3 race shows no numbers before polls open: civicAPI posts test counts beforehand.
  const race = summary.local?.date === ELECTION_DATE && now < FIRST_POLLS_OPEN ? { ...blankResults(detail), counties: detail.counties.map((c) => ({ ...c, reporting: 0, total: 0, candidates: c.candidates.map((x) => ({ ...x, votes: 0, pct: 0 })) })) } : detail;
  remember(otherMemo, id, { at: now, value: race });
  return { race, fetchedAt: now, stale: false };
}

/** One search result: enough to list a race and link to its page. */
export type FoundRace = { id: number; title: string; state: string; type: string; date: string; kind: "local" | "statewide" | "other" };

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
 * civicAPI failure the last answer is used, marked stale. Like race pages, no numbers show before polls open.
 */
export async function searchLive(query: string, now: number): Promise<{ races: RaceSummary[]; stale: boolean }> {
  const key = query.toLowerCase();
  const memo = areaMemo.get(key);
  let answer = memo?.value;
  let stale = false;
  if (!memo || now - memo.at >= FRESH_MS) {
    try {
      answer = await civic(`race/search?query=${encodeURIComponent(query)}&country=US&limit=100`);
      remember(areaMemo, key, { at: now, value: answer });
    } catch (err) {
      if (!memo) throw err;
      stale = true;
    }
  }
  const found = (answer as { races?: unknown } | null)?.races;
  const races = (Array.isArray(found) ? found : []).flatMap((input) => {
    const race = summarizeOther(input, now);
    if (race?.local?.date !== ELECTION_DATE) return [];
    return [now < FIRST_POLLS_OPEN ? blankResults(race) : race];
  });
  return { races, stale };
}
