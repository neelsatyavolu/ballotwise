import { z } from "zod";
import type { Db } from "./auth/accounts";
import { getCached, putCached } from "./cache";
import { needsEstimate } from "./estimate";
import { effectiveAnswers, headlineMatch, type MatchHeadline } from "./match";
import { profileSchema, profileStances, raceSchema, seatsOf, type Profile, type Race } from "./schema";
import { ALIGN_STALE_MS, type Suggested } from "./values";

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
  /** Live line from background research, such as the current web search. */
  activity: string | null;
  candidateCount: number | null;
  candidatesDone: number;
  finishedAt: number | null;
  /** Closest candidate on the voter's answers (own or from the interview), once research is in. */
  match: MatchHeadline | null;
  /** True when interview answers exist for this race. */
  fromInterview: boolean;
  /** Set when mapping the interview onto this ready race failed. Null while that work is still in progress. */
  matchError: string | null;
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
  suggested: Suggested | null;
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
  activity: string | null;
  candidateCount: number | null;
  candidatesDone: number;
  finishedAt: number | null;
  data: string;
  suggested: string | null;
};

const SUMMARY_COLUMNS = `data, suggested, id, title, election_date AS electionDate, election_name AS electionName, updated_at AS updatedAt, status, voted, error,
  activity, candidate_count AS candidateCount, finished_at AS finishedAt,
  (SELECT COUNT(*) FROM guide_profiles gp WHERE gp.guide_id = guides.id) AS candidatesDone`;
function toSummary({ data, suggested, ...r }: GuideRow, profiles: Record<string, Profile>): GuideSummary {
  const parsed = JSON.parse(data) as GuideData | null;
  const fromInterview = suggested ? (JSON.parse(suggested) as Suggested) : null;
  let match: MatchHeadline | null = null;
  if (parsed && r.status === "ready") {
    const all = { ...parsed.profiles, ...profiles };
    const stances = Object.fromEntries(Object.entries(all).map(([id, p]) => [id, profileStances(p)]));
    match = headlineMatch(parsed.race.candidates, stances, parsed.race.issues.map((i) => i.id), effectiveAnswers(parsed.answers, fromInterview), parsed.overrides, seatsOf(parsed.race));
  }
  return {
    ...r,
    voted: r.voted === 1,
    match,
    fromInterview: Boolean(fromInterview),
    // A ready guide's error is an alignment failure. Research failures use status "failed".
    matchError: r.status === "ready" && r.error ? r.error : null,
  };
}

async function backgroundProfiles(db: Db, guideIds: string[]): Promise<Record<string, Record<string, Profile>>> {
  if (guideIds.length === 0) return {};
  const { results } = await db
    .prepare(`SELECT guide_id AS guideId, candidate_id AS candidateId, data FROM guide_profiles WHERE data IS NOT NULL AND guide_id IN (${guideIds.map(() => "?").join(",")})`)
    .bind(...guideIds)
    .all<{ guideId: string; candidateId: string; data: string }>();
  const out: Record<string, Record<string, Profile>> = {};
  for (const r of results) out[r.guideId] = { ...(out[r.guideId] ?? {}), [r.candidateId]: JSON.parse(r.data) as Profile };
  return out;
}

export async function listGuides(db: Db, userId: string, origin: "search" | "ballot"): Promise<GuideSummary[]> {
  const order = origin === "ballot" ? "election_date ASC, title ASC" : "updated_at DESC";
  const { results } = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM guides WHERE user_id = ? AND origin = ? ORDER BY ${order} LIMIT 200`)
    .bind(userId, origin)
    .all<GuideRow>();
  const profiles = await backgroundProfiles(db, results.filter((r) => r.status === "ready").map((r) => r.id));
  return results.map((r) => toSummary(r, profiles[r.id] ?? {}));
}

export async function getGuide(db: Db, userId: string, id: string): Promise<GuideRecord | null> {
  const row = await db
    .prepare("SELECT data, title, status, error, origin, voted, suggested FROM guides WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ data: string; title: string; status: GuideStatus; error: string | null; origin: "search" | "ballot"; voted: number; suggested: string | null }>();
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
    suggested: row.suggested ? (JSON.parse(row.suggested) as Suggested) : null,
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
  const finished = status === "ready" || status === "failed" ? now : null;
  await db
    .prepare("UPDATE guides SET status = ?, error = ?, updated_at = ?, finished_at = ?, activity = CASE WHEN ? IS NULL THEN activity ELSE NULL END WHERE id = ?")
    .bind(status, error, now, finished, finished, id)
    .run();
}

export async function noteGuideActivity(db: Db, id: string, activity: string): Promise<void> {
  await db.prepare("UPDATE guides SET activity = ? WHERE id = ? AND status IN ('queued', 'researching')").bind(activity, id).run();
}

export async function guideForJob(db: Db, id: string): Promise<{ userId: string; query: string; data: GuideData | null; status: GuideStatus } | null> {
  const row = await db
    .prepare("SELECT user_id AS userId, query, data, status FROM guides WHERE id = ?")
    .bind(id)
    .first<{ userId: string; query: string; data: string; status: GuideStatus }>();
  return row ? { userId: row.userId, query: row.query, data: JSON.parse(row.data) as GuideData | null, status: row.status } : null;
}

/**
 * Ready guides whose interview mapping is missing and not already queued.
 * Includes the old boolean claim (`align_requested = 1`), which was stored even
 * when the interview did not exist yet and then never ran again.
 */
export async function claimableGuideIds(db: Db, userId: string, now = Date.now()): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT id FROM guides WHERE user_id = ? AND status = 'ready' AND data != 'null' AND suggested IS NULL AND error IS NULL
       AND (align_requested = 0 OR align_requested = 1 OR align_requested < ?)`,
    )
    .bind(userId, now - ALIGN_STALE_MS)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** Stores the researched race and clears any earlier candidate research for it. */
export async function saveRaceForGuide(db: Db, id: string, query: string, race: Race, now: number): Promise<void> {
  const data: GuideData = { query, race, profiles: {}, answers: {}, overrides: {} };
  await db.batch([
    db.prepare("DELETE FROM guide_profiles WHERE guide_id = ?").bind(id),
    db
      .prepare(
        `UPDATE guides SET data = ?, title = ?, election_date = COALESCE(election_date, ?), status = 'researching', error = NULL,
           updated_at = ?, candidate_count = ?, activity = ? WHERE id = ?`,
      )
      .bind(JSON.stringify(data), race.title, race.date, now, race.candidates.length, `Researching ${race.candidates.length} candidates`, id),
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
): Promise<GuideStatus | null> {
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
    const status = ok > 0 ? "ready" : "failed";
    await setGuideStatus(db, id, status, ok > 0 ? null : "Research didn't finish for any candidate. Try again.", now);
    return status;
  }
  return null;
}

/** The researched profiles for one ballot guide, by candidate. */
export async function guideProfiles(db: Db, id: string): Promise<Record<string, Profile>> {
  return (await backgroundProfiles(db, [id]))[id] ?? {};
}

export async function replaceCandidateProfile(db: Db, id: string, candidateId: string, profile: Profile): Promise<void> {
  await db.prepare("UPDATE guide_profiles SET data = ? WHERE guide_id = ? AND candidate_id = ?").bind(JSON.stringify(profile), id, candidateId).run();
}

/**
 * Ready ballot guides with unknown stances that were researched before estimates existed.
 * Each is claimed once, so loading the page again doesn't queue the same work twice.
 */
export async function claimEstimates(db: Db, userId: string, now: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT gp.guide_id AS id FROM guide_profiles gp JOIN guides g ON g.id = gp.guide_id
       WHERE g.user_id = ? AND g.status = 'ready' AND gp.data LIKE '%"stance":null%'`,
    )
    .bind(userId)
    .all<{ id: string }>();
  const profiles = await backgroundProfiles(db, results.map((r) => r.id));
  const claimed: string[] = [];
  for (const { id } of results) {
    if (!Object.values(profiles[id] ?? {}).some(needsEstimate)) continue;
    if (await getCached(db, `estimating:${id}`, now)) continue;
    await putCached(db, `estimating:${id}`, true, now);
    claimed.push(id);
  }
  return claimed;
}
