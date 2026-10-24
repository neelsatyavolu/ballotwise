import type { Db } from "../auth/accounts";
import { FRESH_MS } from "./civic";
import { advance, isNew, markProcessed, NOT_PROCESSED, observed, type Catalog } from "./ingest";
import type { Office, RaceSummary } from "./races";

export type Call = NonNullable<RaceSummary["call"]>;
/**
 * One change in a race's call, by its database id. `winner` and `party` are null for a withdrawal. `previous` is the
 * winner just before it: null for a first call (or a call after a withdrawal), the withdrawn winner for a withdrawal.
 */
export type CallEvent = {
  id: number;
  raceId: number;
  office: Office;
  kind: "call" | "change" | "withdrawal";
  winner: string | null;
  party: string | null;
  previous: string | null;
  at: number;
};
export type CallEventCounts = Record<Office, number>;
/** Each race's events, oldest first. */
type Log = ReadonlyMap<number, readonly CallEvent[]>;
type Stored = { id: number; race_id: number; office: Office; winner: string | null; party: string | null; previous: string | null; observed_at: number };
/** `processed` is the fetch time of the last catalog recorded; `syncedAt` is when the database was last tried. */
type Memo = { log: Log; lastId: number; loaded: boolean; processed: number; syncedAt: number };

/** How many recent events the overview's feed carries. */
const FEED_SIZE = 100;
const COLUMNS = "id, race_id, office, winner, party, previous, observed_at";

// Appends only when the race's latest stored winner differs, so isolates racing to record the same change write it once,
// and stores that latest winner as `previous`. `IS NOT` treats NULLs as equal, so a withdrawal (NULL) is never written
// for a race with no events or one already withdrawn. Times never go backwards within a race.
const APPEND = `INSERT INTO midterm_call_events (race_id, office, winner, party, previous, observed_at)
  SELECT ?, ?, ?, ?, latest.winner, MAX(?, COALESCE(latest.observed_at, 0))
  FROM (SELECT 1) LEFT JOIN (SELECT winner, observed_at FROM midterm_call_events WHERE race_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1) AS latest
  WHERE latest.winner IS NOT ? AND ${NOT_PROCESSED}`;

const EMPTY: Memo = { log: new Map(), lastId: 0, loaded: false, processed: 0, syncedAt: -Infinity };
// Per-isolate copy of the event log. The database is read (for other isolates' events) and written at most once per FRESH_MS.
let callsMemo: Memo = EMPTY;

export function resetCallsMemo() {
  callsMemo = EMPTY;
}

const kindOf = (winner: string | null, previous: string | null): CallEvent["kind"] => (winner === null ? "withdrawal" : previous === null ? "call" : "change");
const toEvent = (r: Stored): CallEvent => ({ id: r.id, raceId: r.race_id, office: r.office, kind: kindOf(r.winner, r.previous), winner: r.winner, party: r.party, previous: r.previous, at: r.observed_at });

/** Races whose current winner (or lack of one) differs from their latest event. */
function changes(log: Log, races: readonly RaceSummary[]) {
  return races.flatMap((r) => {
    const winner = r.candidates.find((c) => c.winner);
    const latest = log.get(r.id)?.at(-1)?.winner ?? null;
    return (winner?.name ?? null) === latest ? [] : [{ race: r, winner: winner?.name ?? null, party: winner?.party ?? null }];
  });
}

/** Events stored after `lastId`, oldest first. */
async function readSince(db: Db, lastId: number): Promise<CallEvent[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM midterm_call_events WHERE id > ? ORDER BY id`).bind(lastId).all<Stored>();
  return results.map(toEvent);
}

function withEvents(memo: Memo, events: readonly CallEvent[]): Memo {
  if (!events.length) return memo;
  const log = new Map(memo.log);
  for (const e of events) log.set(e.raceId, [...(log.get(e.raceId) ?? []), e]);
  return { ...memo, log, lastId: events[events.length - 1].id };
}

/**
 * Catches up on events other isolates stored, then (for a fresh catalog) appends its changes and moves the
 * processed-through time forward, even when nothing changed. On failure, logs and keeps the memo; the catalog is
 * retried with the next one after FRESH_MS.
 */
async function sync(db: Db, memo: Memo, catalog: Catalog | null, now: number): Promise<Memo> {
  try {
    let next = withEvents({ ...memo, loaded: true }, await readSince(db, memo.lastId));
    if (catalog) {
      const at = catalog.fetchedAt;
      const pending = changes(next.log, observed(catalog));
      const appends = pending.map((c) => db.prepare(APPEND).bind(c.race.id, c.race.office, c.winner, c.party, at, c.race.id, c.winner, "calls", at));
      await db.batch([...appends, markProcessed(db, "calls", at)]);
      if (pending.length) next = withEvents(next, await readSince(db, next.lastId));
    }
    return { ...next, processed: Math.max(next.processed, catalog?.fetchedAt ?? 0), syncedAt: now };
  } catch (err) {
    console.error("midterm calls sync failed:", err);
    return { ...memo, syncedAt: now };
  }
}

/** A race's call from its log: the latest event, with the winner it replaced or withdrew. */
function callOf(events: readonly CallEvent[]): Call | null {
  const latest = events.at(-1);
  if (!latest) return null;
  const previous = events.slice(0, -1).findLast((e) => e.winner !== null)?.winner ?? null;
  if (latest.winner === null) return previous === null ? null : { id: latest.id, at: latest.at, winner: null, replaced: previous, withdrawn: true };
  return { id: latest.id, at: latest.at, winner: latest.winner, replaced: previous === latest.winner ? null : previous, withdrawn: false };
}

function countsOf(log: Log): CallEventCounts {
  const counts: CallEventCounts = { senate: 0, house: 0, governor: 0, measure: 0 };
  for (const events of log.values()) for (const e of events) counts[e.office]++;
  return counts;
}

/**
 * Records changes in each race's call from a fresh catalog newer than the last one processed, since civicAPI gives no
 * call time. Races civicAPI left out (`missing`) aren't observed. A stale or older catalog writes nothing but still gets
 * the known calls. Returns each race's call (absent when never called), the latest events across all races (newest
 * first), and how many events each office has. A database failure never throws.
 */
export async function recordCalls(db: Db, catalog: Catalog, now: number): Promise<{ calls: Map<number, Call>; events: CallEvent[]; counts: CallEventCounts }> {
  const memo = callsMemo;
  const fresh = isNew(catalog, memo.processed);
  // Between syncs, an unchanged fresh catalog only advances the watermark; a changed one waits for the next sync.
  const unchanged = fresh && memo.loaded && changes(memo.log, observed(catalog)).length === 0;
  const next = now - memo.syncedAt >= FRESH_MS ? await sync(db, memo, fresh ? catalog : null, now) : unchanged ? await advance(db, "calls", memo, catalog.fetchedAt, now) : memo;
  callsMemo = next;
  const calls = new Map(catalog.races.flatMap((r) => {
    const call = callOf(next.log.get(r.id) ?? []);
    return call ? [[r.id, call] as const] : [];
  }));
  const events = [...next.log.values()].flat().sort((a, b) => b.id - a.id).slice(0, FEED_SIZE);
  return { calls, events, counts: countsOf(next.log) };
}

/** A page of call events, newest first: optionally one office's, and only those before the event id `before`. Throws on database failure. */
export async function listCallEvents(db: Db, { office, before, limit }: { office?: Office; before?: number; limit: number }): Promise<CallEvent[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM midterm_call_events WHERE (? IS NULL OR office = ?) AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`)
    .bind(office ?? null, office ?? null, before ?? null, before ?? null, limit)
    .all<Stored>();
  return results.map(toEvent);
}

/** A race's call events, oldest first, for the race page. Falls back to this isolate's memory when the database fails. */
export async function callHistory(db: Db, raceId: number): Promise<CallEvent[]> {
  try {
    const { results } = await db.prepare(`SELECT ${COLUMNS} FROM midterm_call_events WHERE race_id = ? ORDER BY observed_at, id`).bind(raceId).all<Stored>();
    return results.map(toEvent);
  } catch (err) {
    console.error("midterm call history failed:", err);
    return [...(callsMemo.log.get(raceId) ?? [])];
  }
}

/**
 * Whether a recorded call agrees with a race's current results: same winner, or a withdrawal while no one is called.
 * The race page fetches its results separately from the catalog, so the two can briefly disagree.
 */
export function agrees(call: Call | null, race: Pick<RaceSummary, "candidates">): boolean {
  const winner = race.candidates.find((c) => c.winner)?.name ?? null;
  return call ? call.winner === winner : winner === null;
}
