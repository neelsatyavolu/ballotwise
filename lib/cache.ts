import { createHash } from "node:crypto";
import type { Db } from "./auth/accounts";
import type { CandidateRef, Race } from "./schema";

/** How long shared research stays fresh. Candidate lists and positions rarely change within days. */
export const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Contests remembered per county, offered to the next ballot lookup there. */
const MAX_KNOWN_CONTESTS = 80;

const hash = (s: string) => createHash("sha256").update(s).digest("base64url").slice(0, 32);
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export const raceKey = (query: string) => `race:${hash(normalize(query))}`;
/** Stances are scored on the race's issues as worded, so a profile is only reused for the same issues. */
export const profileKey = (race: Race, candidate: CandidateRef) =>
  `profile:${hash(JSON.stringify([normalize(race.title), race.date, race.issues, normalize(candidate.name)]))}`;
export const countyKey = (state: string, county: string) => `contests:${hash(normalize(`${state}|${county}`))}`;

export async function getCached<T>(db: Db, key: string, now: number): Promise<T | null> {
  const row = await db.prepare("SELECT data FROM research_cache WHERE key = ? AND created_at > ?").bind(key, now - CACHE_TTL_MS).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as T) : null;
}

export async function putCached(db: Db, key: string, value: unknown, now: number): Promise<void> {
  await db
    .prepare("INSERT INTO research_cache (key, data, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, created_at = excluded.created_at")
    .bind(key, JSON.stringify(value), now)
    .run();
  forgetShared(key);
}

/** How often an isolate asks D1 whether a shared entry it holds has been rewritten. */
export const SHARED_CHECK_MS = 10_000;
/** A held copy is reread in full after this long anyway, in case a rewrite kept both its time and its length. */
export const SHARED_REREAD_MS = 2 * 60_000;
type Held = { createdAt: number; size: number; readAt: number; checkedAt: number; value: unknown };
const shared = new Map<string, Held>();

/** Drops this isolate's parsed copy of `key`, after writing it some other way than putCached. */
export function forgetShared(key: string): void {
  shared.delete(key);
}

/**
 * getCached for the large entries read on nearly every tracker request (ratings, polls, forecast history; up to
 * 700 KB each). Each isolate keeps the parsed copy and rereads it only when its row has been rewritten (a new time
 * or length), which it checks with a small query at most every SHARED_CHECK_MS, and at least every SHARED_REREAD_MS
 * (odds.ts's backfill rewrites history under the same time). Callers share the value, so they must not change it.
 */
export async function getCachedShared<T>(db: Db, key: string, now: number): Promise<T | null> {
  const held = shared.get(key);
  const live = held && held.createdAt > now - CACHE_TTL_MS && now - held.readAt < SHARED_REREAD_MS ? held : null;
  if (live && now - live.checkedAt < SHARED_CHECK_MS) return live.value as T;
  if (live) {
    const row = await db.prepare("SELECT created_at, length(data) AS size FROM research_cache WHERE key = ?").bind(key).first<{ created_at: number; size: number }>();
    if (row?.created_at === live.createdAt && row.size === live.size) {
      shared.set(key, { ...live, checkedAt: now });
      return live.value as T;
    }
  }
  const row = await db
    .prepare("SELECT data, created_at, length(data) AS size FROM research_cache WHERE key = ? AND created_at > ?")
    .bind(key, now - CACHE_TTL_MS)
    .first<{ data: string; created_at: number; size: number }>();
  if (!row) {
    shared.delete(key);
    return null;
  }
  const value = JSON.parse(row.data) as T;
  shared.set(key, { createdAt: row.created_at, size: row.size, readAt: now, checkedAt: now, value });
  return value;
}

export type KnownContest = { label: string; query: string; date: string };

export async function knownContests(db: Db, state: string, county: string | null, now: number): Promise<KnownContest[]> {
  if (!county) return [];
  return (await getCached<KnownContest[]>(db, countyKey(state, county), now)) ?? [];
}

/** Adds newly found contests to the county's list, newest first, so later lookups reuse their exact wording. */
export async function rememberContests(db: Db, state: string, county: string | null, found: KnownContest[], now: number): Promise<void> {
  if (!county || found.length === 0) return;
  const existing = await knownContests(db, state, county, now);
  const seen = new Set(found.map((c) => normalize(c.query)));
  const merged = [...found, ...existing.filter((c) => !seen.has(normalize(c.query)))].slice(0, MAX_KNOWN_CONTESTS);
  await putCached(db, countyKey(state, county), merged, now);
}
