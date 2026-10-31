import type { Db } from "../auth/accounts";
import { FRESH_MS } from "./civic";
import { isNew, observed, type Catalog } from "./ingest";
import type { Office, RaceSummary } from "./races";

export type Call = NonNullable<RaceSummary["call"]>;
/**
 * One change in a race's call, by its database id. `winner` and `party` are null for a withdrawal. `previous` is the
 * winner just before it: null for a first call (or a call after a withdrawal), the withdrawn winner for a withdrawal.
 */
export type CallEvent = {
  /** Private current-state DDHQ event; absent on the shared civicAPI call history. */
  source?: "ddhq";
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
// for a race with no events or one already withdrawn. Times never go backwards within a race. Written only while the
// catalog's claim (CLAIM, earlier in the same batch) holds.
const APPEND = `INSERT INTO midterm_call_events (race_id, office, winner, party, previous, observed_at)
  SELECT ?, ?, ?, ?, latest.winner, MAX(?, COALESCE(latest.observed_at, 0))
  FROM (SELECT 1) LEFT JOIN (SELECT winner, observed_at FROM midterm_call_events WHERE race_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1) AS latest
  WHERE latest.winner IS NOT ? AND (SELECT at FROM midterm_ingest WHERE key = 'calls') = ?`;

/**
 * Claims a catalog fetched at the first bind: moves the calls watermark forward to it, but only while the newest event
 * stored is the one this isolate last read (second bind). The changes were worked out against that log, so if another
 * isolate stored an event since, the claim fails and the log is read again; an older catalog can't claim either.
 * Returns the row when the claim took.
 */
const CLAIM = `INSERT INTO midterm_ingest (key, at) SELECT 'calls', ?1 WHERE (SELECT COALESCE(MAX(id), 0) FROM midterm_call_events) = ?2
  ON CONFLICT (key) DO UPDATE SET at = excluded.at WHERE excluded.at > midterm_ingest.at RETURNING at`;
/** Tries to claim a catalog this many times before leaving it for the next one. */
const CLAIM_ATTEMPTS = 3;
/** Between syncs, an unchanged fresh catalog at least this much newer than the watermark still claims it. */
const CLAIM_SLACK_MS = 5_000;

const EMPTY: Memo = { log: new Map(), lastId: 0, loaded: false, processed: 0, syncedAt: -Infinity };
// Per-isolate copy of the event log. The database is read (for other isolates' events) and written at most once per FRESH_MS.
let callsMemo: Memo = EMPTY;

export function resetCallsMemo() {
  callsMemo = EMPTY;
}

const kindOf = (winner: string | null, previous: string | null): CallEvent["kind"] => (winner === null ? "withdrawal" : previous === null ? "call" : "change");
const toEvent = (r: Stored): CallEvent => ({ id: r.id, raceId: r.race_id, office: r.office, kind: kindOf(r.winner, r.previous), winner: r.winner, party: r.party, previous: r.previous, at: r.observed_at });

/**
 * Races whose current winner (or lack of one) differs from their latest event. A race whose answer didn't say who won
 * (`callUnknown`) keeps its last call: a missing field isn't a withdrawal.
 */
function changes(log: Log, races: readonly RaceSummary[]) {
  return races.flatMap((r) => {
    if (r.callUnknown) return [];
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

/** The calls watermark as stored, or 0 before the first claim. */
async function watermark(db: Db): Promise<number> {
  return (await db.prepare("SELECT at FROM midterm_ingest WHERE key = 'calls'").first<{ at: number }>())?.at ?? 0;
}

/**
 * Catches up on events other isolates stored, then (for a fresh catalog) claims it and appends its changes in one
 * batch. A claim lost to another isolate's new event reads the log again and retries; one lost to a newer catalog
 * leaves this one unrecorded. On failure, logs and keeps the memo; the catalog is retried with the next one after FRESH_MS.
 */
async function sync(db: Db, memo: Memo, catalog: Catalog | null, now: number): Promise<Memo> {
  try {
    let next = withEvents({ ...memo, loaded: true }, await readSince(db, memo.lastId));
    if (catalog) {
      const at = catalog.fetchedAt;
      const unknown = observed(catalog).filter((r) => r.callUnknown && next.log.get(r.id)?.at(-1)?.winner);
      if (unknown.length) console.warn(`midterm calls: civicAPI's answer left out who won called races ${unknown.map((r) => r.id).join(", ")}; keeping their calls`);
      for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt++) {
        const pending = changes(next.log, observed(catalog));
        const appends = pending.map((c) => db.prepare(APPEND).bind(c.race.id, c.race.office, c.winner, c.party, at, c.race.id, c.winner, at));
        await db.batch([db.prepare(CLAIM).bind(at, next.lastId), ...appends]);
        const mark = await watermark(db);
        next = withEvents(next, await readSince(db, next.lastId));
        if (mark >= at) break;
        if (attempt === CLAIM_ATTEMPTS) console.error(`midterm calls: gave up claiming the catalog fetched at ${at} after ${attempt} tries`);
      }
    }
    return { ...next, processed: Math.max(next.processed, catalog?.fetchedAt ?? 0), syncedAt: now };
  } catch (err) {
    console.error("midterm calls sync failed:", err);
    return { ...memo, syncedAt: now };
  }
}

/**
 * Between syncs, claims a fresh catalog that changes nothing this isolate knows of with one statement, so another
 * isolate can't record an older, differing one afterwards. When another isolate has stored an event since this one
 * last read the log, the claim fails and a full sync works the catalog out against the stored log instead.
 */
async function claimUnchanged(db: Db, memo: Memo, catalog: Catalog, now: number): Promise<Memo> {
  if (catalog.fetchedAt - memo.processed <= CLAIM_SLACK_MS) return memo;
  try {
    const claimed = await db.prepare(CLAIM).bind(catalog.fetchedAt, memo.lastId).first<{ at: number }>();
    if (claimed) return { ...memo, processed: catalog.fetchedAt };
  } catch (err) {
    console.error("midterm calls claim failed:", err);
    return { ...memo, syncedAt: now };
  }
  return sync(db, memo, catalog, now);
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
  // Between syncs, an unchanged fresh catalog is only claimed; a changed one waits for the next sync.
  const unchanged = fresh && memo.loaded && changes(memo.log, observed(catalog)).length === 0;
  const next = now - memo.syncedAt >= FRESH_MS ? await sync(db, memo, fresh ? catalog : null, now) : unchanged ? await claimUnchanged(db, memo, catalog, now) : memo;
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

/** Call events stored after event `afterId`, oldest first, for push notifications. */
export async function callEventsAfter(db: Db, afterId: number, limit: number): Promise<CallEvent[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM midterm_call_events WHERE id > ? ORDER BY id LIMIT ?`).bind(afterId, limit).all<Stored>();
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
