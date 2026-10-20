import type { Db } from "../auth/accounts";

/** A voter can star at most this many races. */
export const MAX_FAVORITES = 200;

export async function listFavorites(db: Db, userId: string): Promise<number[]> {
  const { results } = await db.prepare("SELECT race_id FROM midterm_favorites WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<{ race_id: number }>();
  return results.map((r) => r.race_id);
}

export async function addFavorite(db: Db, userId: string, raceId: number, now: number): Promise<void> {
  await db.prepare("INSERT INTO midterm_favorites (user_id, race_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(userId, raceId, now).run();
}

/** Stars several races at once, skipping ones already starred. */
export async function addFavorites(db: Db, userId: string, raceIds: readonly number[], now: number): Promise<void> {
  if (raceIds.length === 0) return;
  await db.batch(raceIds.map((id, i) => db.prepare("INSERT INTO midterm_favorites (user_id, race_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(userId, id, now + i)));
}

export async function removeFavorite(db: Db, userId: string, raceId: number): Promise<void> {
  await db.prepare("DELETE FROM midterm_favorites WHERE user_id = ? AND race_id = ?").bind(userId, raceId).run();
}
