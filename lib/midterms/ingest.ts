import type { Db, Statement } from "../auth/accounts";
import type { RaceSummary } from "./races";

/** The recorders that turn civicAPI catalogs into rows, each with its own processed-through time in midterm_ingest. */
export type IngestKey = "calls" | "history";
/**
 * The catalog as fetchCatalog serves it. Only fresh catalogs newer than the last one processed are recorded; one
 * pieced together from D1's per-race snapshots (`stored`) isn't a single observation, so it's never recorded.
 */
export type Catalog = { races: readonly RaceSummary[]; fetchedAt: number; stale: boolean; stored?: true };

/**
 * SQL condition for an insert's WHERE: true while the recorder (first bind) hasn't processed a catalog fetched at or after
 * the second bind. Checked inside the write batch, so isolates racing with different catalogs can't write an older one last.
 */
export const NOT_PROCESSED = "COALESCE((SELECT at FROM midterm_ingest WHERE key = ?), 0) < ?";

/** Moves a recorder's processed-through time forward to `at`, never back. Goes last in the write batch. */
export function markProcessed(db: Db, key: IngestKey, at: number): Statement {
  return db.prepare("INSERT INTO midterm_ingest (key, at) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET at = excluded.at WHERE excluded.at > midterm_ingest.at").bind(key, at);
}

/** Whether a catalog should be recorded: one fresh civicAPI answer, fetched after the last one this isolate processed. */
export const isNew = (catalog: Catalog, processed: number) => !catalog.stale && !catalog.stored && catalog.fetchedAt > processed;

/** The races a catalog actually observed: a `missing` race only repeats numbers from an older answer. */
export const observed = (catalog: Catalog) => catalog.races.filter((r) => !r.missing);

/** Between syncs, an unchanged fresh catalog at least this much newer than the watermark still advances it durably. */
const ADVANCE_SLACK_MS = 5_000;

/**
 * Durably marks an unchanged fresh catalog processed between syncs, so another isolate can't commit an older,
 * differing one in the meantime. `processed` moves only once the database has it. On failure, logs and sets
 * `syncedAt` so the database isn't retried until the next sync is due.
 */
export async function advance<M extends { processed: number; syncedAt: number }>(db: Db, key: IngestKey, memo: M, at: number, now: number): Promise<M> {
  if (at - memo.processed <= ADVANCE_SLACK_MS) return memo;
  try {
    await markProcessed(db, key, at).run();
    return { ...memo, processed: at };
  } catch (err) {
    console.error(`midterm ${key} watermark advance failed:`, err);
    return { ...memo, syncedAt: now };
  }
}
