import { z } from "zod";
import type { Db } from "./auth/accounts";
import { profileSchema, raceSchema, type Profile, type Race } from "./schema";

const MAX_GUIDE_BYTES = 400_000;

/** A saved guide: one race, the candidate research, and the voter's own answers and corrections. */
export const guideDataSchema = z.object({
  query: z.string().max(220),
  race: raceSchema.extend({ sources: z.array(z.string()).max(12) }),
  profiles: z.record(z.string(), profileSchema),
  answers: z.record(z.string(), z.object({ stance: z.number().int().min(-2).max(2).nullable(), weight: z.union([z.literal(1), z.literal(2), z.literal(3)]) })),
  overrides: z.record(z.string(), z.record(z.string(), z.number().int().min(-2).max(2).nullable())),
});
export type GuideData = z.infer<typeof guideDataSchema>;
export type GuideStatus = "queued" | "researching" | "ready" | "failed";
export type GuideSummary = {
  id: string;
  title: string;
  electionDate: string | null;
  electionName: string | null;
  updatedAt: number;
  status: GuideStatus;
  voted: boolean;
  error: string | null;
};
/** What the guide page loads: the data once the race is known, plus background research state. */
export type GuideRecord = {
  data: GuideData | null;
  title: string;
  status: GuideStatus;
  error: string | null;
  origin: "search" | "ballot";
  voted: boolean;
  failedCandidates: Record<string, string>;
};

export const guideIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/);

type GuideRow = {
  id: string;
  title: string;
  electionDate: string | null;
  electionName: string | null;
  updatedAt: number;
  status: GuideStatus;
  voted: number;
  error: string | null;
};

const SUMMARY_COLUMNS =
  "id, title, election_date AS electionDate, election_name AS electionName, updated_at AS updatedAt, status, voted, error";
const toSummary = (r: GuideRow): GuideSummary => ({ ...r, voted: r.voted === 1 });

export async function listGuides(db: Db, userId: string, origin: "search" | "ballot"): Promise<GuideSummary[]> {
  const order = origin === "ballot" ? "election_date ASC, title ASC" : "updated_at DESC";
  const { results } = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM guides WHERE user_id = ? AND origin = ? ORDER BY ${order} LIMIT 200`)
    .bind(userId, origin)
    .all<GuideRow>();
  return results.map(toSummary);
}

export async function getGuide(db: Db, userId: string, id: string): Promise<GuideRecord | null> {
  const row = await db
    .prepare("SELECT data, title, status, error, origin, voted FROM guides WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ data: string; title: string; status: GuideStatus; error: string | null; origin: "search" | "ballot"; voted: number }>();
  if (!row) return null;
  const parsed = JSON.parse(row.data) as GuideData | null;
  const { results } = await db
    .prepare("SELECT candidate_id AS candidateId, data, error FROM guide_profiles WHERE guide_id = ?")
    .bind(id)
    .all<{ candidateId: string; data: string | null; error: string | null }>();
  const background = Object.fromEntries(results.filter((r) => r.data).map((r) => [r.candidateId, JSON.parse(r.data!) as Profile]));
  const failedCandidates = Object.fromEntries(results.filter((r) => !r.data && r.error).map((r) => [r.candidateId, r.error!]));
  return {
    data: parsed ? { ...parsed, profiles: { ...parsed.profiles, ...background } } : null,
    title: row.title,
    status: row.status,
    error: row.error,
    origin: row.origin,
    voted: row.voted === 1,
    failedCandidates,
  };
}

/** Creates or replaces a guide the user owns. Another user's guide with the same id is left untouched. */
export async function saveGuide(db: Db, userId: string, id: string, data: GuideData, now: number): Promise<boolean> {
  const json = JSON.stringify(data);
  if (json.length > MAX_GUIDE_BYTES) return false;
  const owner = await db.prepare("SELECT user_id FROM guides WHERE id = ?").bind(id).first<{ user_id: string }>();
  if (owner && owner.user_id !== userId) return false;
  await db
    .prepare(
      `INSERT INTO guides (id, user_id, title, election_date, data, updated_at, query) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, election_date = excluded.election_date, data = excluded.data, updated_at = excluded.updated_at`,
    )
    .bind(id, userId, data.race.title, data.race.date, json, now, data.query)
    .run();
  return true;
}

export async function setVoted(db: Db, userId: string, id: string, voted: boolean): Promise<void> {
  await db.prepare("UPDATE guides SET voted = ? WHERE id = ? AND user_id = ?").bind(voted ? 1 : 0, id, userId).run();
}

export async function deleteGuide(db: Db, userId: string, id: string): Promise<void> {
  await db.prepare("DELETE FROM guides WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

// Background research, written by queue jobs.

export async function setGuideStatus(db: Db, id: string, status: GuideStatus, error: string | null, now: number): Promise<void> {
  await db.prepare("UPDATE guides SET status = ?, error = ?, updated_at = ? WHERE id = ?").bind(status, error, now, id).run();
}

export async function guideForJob(db: Db, id: string): Promise<{ userId: string; query: string; data: GuideData | null } | null> {
  const row = await db.prepare("SELECT user_id AS userId, query, data FROM guides WHERE id = ?").bind(id).first<{ userId: string; query: string; data: string }>();
  return row ? { userId: row.userId, query: row.query, data: JSON.parse(row.data) as GuideData | null } : null;
}

/** Stores the researched race and clears any earlier candidate research for it. */
export async function saveRaceForGuide(db: Db, id: string, query: string, race: Race, now: number): Promise<void> {
  const data: GuideData = { query, race, profiles: {}, answers: {}, overrides: {} };
  await db.batch([
    db.prepare("DELETE FROM guide_profiles WHERE guide_id = ?").bind(id),
    db
      .prepare("UPDATE guides SET data = ?, title = ?, election_date = COALESCE(election_date, ?), status = 'researching', error = NULL, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(data), race.title, race.date, now, id),
  ]);
}

/** Records one candidate's research, then marks the guide ready once every candidate has an outcome. */
export async function saveCandidateResult(
  db: Db,
  id: string,
  candidateId: string,
  result: { profile: Profile } | { error: string },
  candidateCount: number,
  now: number,
): Promise<void> {
  const [data, error] = "profile" in result ? [JSON.stringify(result.profile), null] : [null, result.error];
  await db
    .prepare(
      `INSERT INTO guide_profiles (guide_id, candidate_id, data, error) VALUES (?, ?, ?, ?)
       ON CONFLICT(guide_id, candidate_id) DO UPDATE SET data = excluded.data, error = excluded.error`,
    )
    .bind(id, candidateId, data, error)
    .run();
  const counts = await db
    .prepare("SELECT COUNT(*) AS done, SUM(CASE WHEN data IS NOT NULL THEN 1 ELSE 0 END) AS ok FROM guide_profiles WHERE guide_id = ?")
    .bind(id)
    .first<{ done: number; ok: number | null }>();
  if (counts && counts.done >= candidateCount) {
    const ok = counts.ok ?? 0;
    await setGuideStatus(db, id, ok > 0 ? "ready" : "failed", ok > 0 ? null : "Research didn't finish for any candidate. Try again.", now);
  }
}
