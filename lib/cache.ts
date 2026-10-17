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
