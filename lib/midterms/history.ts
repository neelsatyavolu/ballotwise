import type { Db } from "../auth/accounts";
import { FRESH_MS } from "./civic";
import { advance, isNew, markProcessed, NOT_PROCESSED, observed, type Catalog } from "./ingest";
import type { RaceSummary } from "./races";

export type Trend = NonNullable<RaceSummary["trend"]>;
/**
 * A race's numbers when its votes changed. `margin` is the leader's lead over second place in points, from raw votes.
 * `reporting` is null when civicAPI gave no reporting figure. `corrected` is set when any candidate's votes went down.
 */
export type Observation = { at: number; total: number; leadName: string | null; leadParty: string | null; margin: number | null; reporting: number | null; corrected: boolean };
/** Each candidate's votes, by name. */
type Votes = Readonly<Record<string, number>>;
type Point = Observation & { id: number; raceId: number; votes: Votes };
type Stored = {
  id: number;
  race_id: number;
  observed_at: number;
  total: number;
  votes: string;
  lead_name: string | null;
  lead_party: string | null;
  margin: number | null;
  reporting: number | null;
  corrected: number;
};
/** Each race's observations, oldest first, trimmed to what the trend needs. */
type Log = ReadonlyMap<number, readonly Point[]>;
type Memo = { log: Log; lastId: number; loaded: boolean; processed: number; syncedAt: number };

/** Ordinary vote additions are sampled at most this often; leader changes and corrections are recorded right away. */
const MIN_GAP_MS = 5 * 60 * 1000;
/** The trend compares against the race's numbers this long ago. */
const TREND_MS = 15 * 60 * 1000;

const COLUMNS = "id, race_id, observed_at, total, votes, lead_name, lead_party, margin, reporting, corrected";
// Rechecks the change and the gap against the table, so isolates racing on the same catalog write once.
// The 9th bind is 1 for a leader change or correction, which skips the gap.
const INSERT = `INSERT INTO midterm_history (race_id, observed_at, total, votes, lead_name, lead_party, margin, reporting, corrected)
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE COALESCE((SELECT votes FROM midterm_history WHERE race_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1), '') <> ?
    AND (? OR NOT EXISTS (SELECT 1 FROM midterm_history WHERE race_id = ? AND observed_at > ?))
    AND ${NOT_PROCESSED}`;
// Every observation newer than the cutoff plus each race's last one before it, the trend's baseline.
// `older` counts a race's observations at or before the cutoff, newest first.
const RECENT = `SELECT ${COLUMNS} FROM (
    SELECT *, SUM(observed_at <= ?) OVER (PARTITION BY race_id ORDER BY observed_at DESC, id DESC ROWS UNBOUNDED PRECEDING) AS older FROM midterm_history
  ) WHERE older <= 1 ORDER BY id`;
const SINCE = `SELECT ${COLUMNS} FROM midterm_history WHERE id > ? ORDER BY id`;

const EMPTY: Memo = { log: new Map(), lastId: 0, loaded: false, processed: 0, syncedAt: -Infinity };
// Per-isolate copy of recent observations, so races whose votes didn't change cost nothing.
let historyMemo: Memo = EMPTY;

export function resetHistoryMemo() {
  historyMemo = EMPTY;
}

const toPoint = (r: Stored): Point => ({
  id: r.id,
  raceId: r.race_id,
  at: r.observed_at,
  total: r.total,
  votes: JSON.parse(r.votes) as Votes,
  leadName: r.lead_name,
  leadParty: r.lead_party,
  margin: r.margin,
  reporting: r.reporting,
  corrected: r.corrected === 1,
});
const observation = ({ at, total, leadName, leadParty, margin, reporting, corrected }: Point): Observation => ({ at, total, leadName, leadParty, margin, reporting, corrected });

/** Votes by candidate name, in name order so equal votes serialize the same. */
const votesOf = (race: RaceSummary): Votes => Object.fromEntries(race.candidates.map((c) => [c.name, c.votes] as const).sort(([a], [b]) => a.localeCompare(b)));
const sameVotes = (a: Votes, b: Votes) => JSON.stringify(a) === JSON.stringify(b);
/** Whether any candidate in `before` has fewer votes now (a candidate who dropped out of the list counts as zero). */
const wentDown = (before: Votes, now: Votes) => Object.entries(before).some(([name, votes]) => (now[name] ?? 0) < votes);

/** The race's numbers now, as an observation at `at`, compared with its last one. */
function observe(race: RaceSummary, at: number, last: Point | undefined): Omit<Point, "id"> {
  const [first, second] = [...race.candidates].sort((a, b) => b.votes - a.votes);
  const votes = votesOf(race);
  return {
    raceId: race.id,
    at,
    total: race.total,
    votes,
    leadName: first?.name ?? null,
    leadParty: first?.party ?? null,
    margin: first && race.total ? ((first.votes - (second?.votes ?? 0)) / race.total) * 100 : null,
    reporting: race.reportingUnknown ? null : race.reporting,
    corrected: !!last && wentDown(last.votes, votes),
  };
}

/**
 * Observations to record: races whose votes changed since their last observation (a race never observed starts from
 * zero). Additions wait out the gap; a leader change or a correction doesn't.
 */
function changes(log: Log, races: readonly RaceSummary[], at: number) {
  return races.flatMap((r) => {
    const last = log.get(r.id)?.at(-1);
    const next = observe(r, at, last);
    if (!last) return next.total > 0 ? [{ next, urgent: false }] : [];
    if (sameVotes(last.votes, next.votes)) return [];
    const urgent = next.corrected || next.leadName !== last.leadName;
    return urgent || at - last.at >= MIN_GAP_MS ? [{ next, urgent }] : [];
  });
}

/** Drops observations the trend can no longer reach: keeps everything after the cutoff and the last one before it. */
function trimmed(points: readonly Point[], cutoff: number): readonly Point[] {
  const older = points.filter((p) => p.at <= cutoff).length;
  return older > 1 ? points.slice(older - 1) : points;
}

function withPoints(memo: Memo, points: readonly Point[], now: number): Memo {
  if (!points.length) return memo;
  const log = new Map(memo.log);
  for (const p of points) log.set(p.raceId, [...(log.get(p.raceId) ?? []), p]);
  for (const id of new Set(points.map((p) => p.raceId))) log.set(id, trimmed(log.get(id) ?? [], now - TREND_MS));
  return { ...memo, log, lastId: Math.max(memo.lastId, points[points.length - 1].id) };
}

async function readPoints(db: Db, sql: string, bound: number): Promise<Point[]> {
  return (await db.prepare(sql).bind(bound).all<Stored>()).results.map(toPoint);
}

/**
 * Loads recent observations (or catches up on ones other isolates stored), then, for a fresh catalog, records its
 * changes and moves the processed-through time forward, even when nothing changed. On failure, logs and keeps the memo.
 */
async function sync(db: Db, memo: Memo, catalog: Catalog | null, now: number): Promise<Memo> {
  try {
    const caughtUp = memo.loaded ? await readPoints(db, SINCE, memo.lastId) : await readPoints(db, RECENT, now - TREND_MS);
    let next = withPoints({ ...memo, loaded: true }, caughtUp, now);
    if (catalog) {
      const at = catalog.fetchedAt;
      const pending = changes(next.log, observed(catalog), at);
      const inserts = pending.map(({ next: p, urgent }) =>
        db.prepare(INSERT).bind(p.raceId, p.at, p.total, JSON.stringify(p.votes), p.leadName, p.leadParty, p.margin, p.reporting, p.corrected ? 1 : 0, p.raceId, JSON.stringify(p.votes), urgent ? 1 : 0, p.raceId, p.at - MIN_GAP_MS, "history", at),
      );
      await db.batch([...inserts, markProcessed(db, "history", at)]);
      if (pending.length) next = withPoints(next, await readPoints(db, SINCE, next.lastId), now);
    }
    return { ...next, processed: Math.max(next.processed, catalog?.fetchedAt ?? 0), syncedAt: now };
  } catch (err) {
    console.error("midterm history sync failed:", err);
    return { ...memo, syncedAt: now };
  }
}

/**
 * The race's trend: its current numbers against the baseline, its last observation at or before 15 minutes ago (or
 * its oldest when every observation is newer). Null without observations, or when nothing changed since the baseline.
 */
function trendOf(points: readonly Point[], race: RaceSummary, now: number): Trend | null {
  const latest = points.at(-1);
  if (!latest) return null;
  const baseline = points.findLast((p) => p.at <= now - TREND_MS) ?? points[0];
  if (sameVotes(baseline.votes, votesOf(race))) return null;
  return { since: baseline.at, baselineAt: baseline.at, votesAdded: race.total - baseline.total, prevMargin: baseline.margin, prevLeader: baseline.leadName, lastChange: latest.at };
}

/**
 * Records each race whose votes changed, from a fresh catalog newer than the last one processed, and returns each
 * race's trend (absent when null). Races civicAPI left out (`missing`) aren't observed, and a stale or older catalog
 * writes nothing. The database is read and written at most once per FRESH_MS. Never throws.
 */
export async function recordHistory(db: Db, catalog: Catalog, now: number): Promise<Map<number, Trend>> {
  const memo = historyMemo;
  const fresh = isNew(catalog, memo.processed);
  const unchanged = fresh && memo.loaded && changes(memo.log, observed(catalog), catalog.fetchedAt).length === 0;
  // Between syncs, an unchanged fresh catalog only advances the watermark; a changed one waits for the next sync.
  const next = now - memo.syncedAt >= FRESH_MS ? await sync(db, memo, fresh ? catalog : null, now) : unchanged ? await advance(db, "history", memo, catalog.fetchedAt, now) : memo;
  historyMemo = next;
  return new Map(catalog.races.flatMap((r) => {
    const trend = trendOf(next.log.get(r.id) ?? [], r, now);
    return trend ? [[r.id, trend] as const] : [];
  }));
}

/** A race's latest observations, newest first, for the race page. Falls back to this isolate's memory when the database fails. */
export async function raceHistory(db: Db, raceId: number, limit = 12): Promise<Observation[]> {
  try {
    const { results } = await db.prepare(`SELECT ${COLUMNS} FROM midterm_history WHERE race_id = ? ORDER BY observed_at DESC, id DESC LIMIT ?`).bind(raceId, limit).all<Stored>();
    return results.map((r) => observation(toPoint(r)));
  } catch (err) {
    console.error("midterm race history failed:", err);
    return [...(historyMemo.log.get(raceId) ?? [])].reverse().slice(0, limit).map(observation);
  }
}
