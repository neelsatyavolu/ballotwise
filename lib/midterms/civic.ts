import type { Db } from "../auth/accounts";
import { coverageOf, type Coverage } from "./coverage";
import { applyRatings, blankResults, ELECTION_DATE, FIRST_POLLS_OPEN, raceDetail, summarize, type Office, type RaceDetail, type RaceSummary, type RatedRace } from "./races";
import { STATE_NAMES } from "./view";

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

const RETRY_DELAYS_MS = [300, 1000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** civicAPI answers 503 now and then under load, so each request is retried twice after a short pause. */
async function civic(path: string): Promise<unknown> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await civicOnce(path);
    } catch {
      await sleep(delay);
    }
  }
  return civicOnce(path);
}

/** Runs `work` over `items` with at most `limit` in flight, keeping results in order. */
async function pooled<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
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
/** A catalog as of `at`. Races without `missing` were in civicAPI's answer at `at`; missing ones carry `lastSeen`. */
type Stored = Memo<RaceSummary[]>;
// Per-isolate memory of the last served catalog, so a civicAPI outage shows slightly old results instead of none.
let catalogMemo: Stored | null = null;
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
  raceMemo.clear();
  lastWriteAt = 0;
  written.clear();
  registryMemo = null;
}

export type Fetched<T> = T & { fetchedAt: number; stale: boolean };

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
  return { at: Math.max(...entries.map((e) => e.seen)), value: entries.map((e) => e.race) };
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

async function fetchRaces(now: number): Promise<RaceSummary[]> {
  // Two searches at a time: civicAPI answers 503 more often when hit with all six at once.
  const pages = await pooled(TYPES, 2, racesOfType);
  // A race can appear under two type searches; keep the first.
  const byId = new Map<number, RaceSummary>();
  for (const raw of pages.flat()) {
    const race = summarize(raw, []);
    if (race && !byId.has(race.id)) byId.set(race.id, now < FIRST_POLLS_OPEN ? blankResults(race) : race);
  }
  return [...byId.values()];
}

const served = (memo: Stored, ratings: readonly RatedRace[], stale: boolean) => ({ races: applyRatings(memo.value, ratings), coverage: coverageOf(memo.value), fetchedAt: memo.at, stale });

/**
 * Every tracked race with its statewide (or districtwide) totals. Every race ever seen (in this isolate, in D1's
 * race snapshots or in the registry) stays listed; one civicAPI leaves out keeps its last numbers with `missing: true`.
 * When civicAPI doesn't answer at all, the last catalog (from memory, else from `db`) is served marked stale.
 * `background` lets the D1 writes finish after the response.
 */
export async function fetchCatalog(
  now: number,
  ratings: readonly RatedRace[] = [],
  db?: Db,
  background?: (work: Promise<unknown>) => void,
): Promise<Fetched<{ races: RaceSummary[]; coverage: Coverage }>> {
  // The memo holds races without ratings; each caller's ratings are attached on the way out.
  if (catalogMemo && now - catalogMemo.at < FRESH_MS) return served(catalogMemo, ratings, false);
  // A fresh isolate has no memo, so D1 stands in for it; it and the registry are read while civicAPI is asked.
  const warm = catalogMemo;
  const snapshots = warm || !db ? Promise.resolve(null) : readRaceSnapshots(db);
  const registeredRaces = registry(db, now);
  let fetched: RaceSummary[];
  try {
    fetched = await fetchRaces(now);
  } catch (err) {
    const last = warm ?? fromSnapshots(await snapshots);
    if (!last) throw err;
    catalogMemo = { at: last.at, value: last.value.filter((r) => !RETIRED_RACE_IDS.has(r.id)) };
    return served(catalogMemo, ratings, true);
  }
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
  catalogMemo = { at: now, value: races };
  if (db) {
    const newcomers = registered ? fetched.filter((r) => !registered.has(r.id)) : [];
    const write = saveRaces(db, fetched, newcomers, now, fetched.some((r) => !known.has(r.id)));
    if (write) await handOff(write, background);
  }
  return served(catalogMemo, ratings, false);
}

/** One tracked race (from the catalog) with county results. */
export async function fetchRace(summary: RaceSummary, now: number, baseline: Readonly<Record<string, readonly [number, number, number]>>): Promise<Fetched<{ race: RaceDetail }>> {
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
