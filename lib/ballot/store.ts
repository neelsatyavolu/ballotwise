import { createHash } from "node:crypto";
import type { Db } from "../auth/accounts";
import type { BallotContests } from "../schema";
import type { Districts } from "./census";

export type BallotStatus = "finding" | "ready" | "failed";
export type Ballot = {
  address: string;
  matchedAddress: string;
  districts: Districts;
  status: BallotStatus;
  error: string | null;
  updatedAt: number;
  /** What the contest search is doing right now, while status is "finding". */
  activity: string | null;
  searches: number;
  startedAt: number | null;
  /** False for a ballot found before judges were covered, until its judges are looked for or the offer is declined. */
  judgesChecked: boolean;
};

export async function saveBallot(db: Db, userId: string, address: string, matchedAddress: string, districts: Districts, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ballots (user_id, address, matched_address, districts, status, error, updated_at, activity, searches, started_at, judges_checked)
       VALUES (?, ?, ?, ?, 'finding', NULL, ?, NULL, 0, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET address = excluded.address, matched_address = excluded.matched_address,
         districts = excluded.districts, status = 'finding', error = NULL, updated_at = excluded.updated_at,
         activity = NULL, searches = 0, started_at = excluded.started_at, judges_checked = 1`,
    )
    .bind(userId, address, matchedAddress, JSON.stringify(districts), now, now)
    .run();
}

/** Why a ballot's contests weren't looked for: research runs on the voter's Grok account. */
export const GROK_MISSING = "Grok isn't connected. Connect Grok, then refresh your ballot.";

/**
 * Saves the voting address without finding contests, for a voter who hasn't connected Grok: the Near you screen needs
 * only its districts. The ballot reads as a ballot job leaves it when Grok is missing, so the ballot page says to
 * connect Grok, and trying again then finds the contests.
 */
export async function saveAddress(db: Db, userId: string, address: string, matchedAddress: string, districts: Districts, now: number): Promise<void> {
  await saveBallot(db, userId, address, matchedAddress, districts, now);
  await setBallotStatus(db, userId, "failed", GROK_MISSING, now);
}

export async function getBallot(db: Db, userId: string): Promise<Ballot | null> {
  const row = await db
    .prepare(
      `SELECT address, matched_address AS matchedAddress, districts, status, error, updated_at AS updatedAt,
         activity, searches, started_at AS startedAt, judges_checked AS judgesChecked FROM ballots WHERE user_id = ?`,
    )
    .bind(userId)
    .first<Omit<Ballot, "districts" | "judgesChecked"> & { districts: string; judgesChecked: number }>();
  return row ? { ...row, districts: JSON.parse(row.districts) as Districts, judgesChecked: row.judgesChecked === 1 } : null;
}

export async function setBallotStatus(db: Db, userId: string, status: BallotStatus, error: string | null, now: number): Promise<void> {
  // Starting a new search resets the live counters; finishing clears the activity line.
  const reset = status === "finding" ? ", activity = NULL, searches = 0, started_at = ?" : ", activity = NULL";
  const values = status === "finding" ? [status, error, now, now, userId] : [status, error, now, userId];
  await db.prepare(`UPDATE ballots SET status = ?, error = ?, updated_at = ?${reset} WHERE user_id = ?`).bind(...values).run();
}

/** Records that this ballot's judges were looked for, or that the voter declined. */
export async function setJudgesChecked(db: Db, userId: string): Promise<void> {
  await db.prepare("UPDATE ballots SET judges_checked = 1 WHERE user_id = ?").bind(userId).run();
}

export async function noteBallotActivity(db: Db, userId: string, activity: string, newSearches: number): Promise<void> {
  await db.prepare("UPDATE ballots SET activity = ?, searches = searches + ? WHERE user_id = ? AND status = 'finding'").bind(activity, newSearches, userId).run();
}

const normalizeLabel = (label: string) => label.trim().toLowerCase().replace(/\s+/g, " ");

/** Same contest, same id: finding contests again never duplicates a guide or loses answers already given. */
export function contestGuideId(userId: string, date: string, label: string): string {
  const key = `${userId}|${date}|${normalizeLabel(label)}`;
  return `b${createHash("sha256").update(key).digest("base64url").slice(0, 21)}`;
}

/**
 * The guide already tracking this contest, if any. The label can be worded differently each time
 * contests are found, so a guide whose researched title matches the label counts as the same contest.
 */
async function existingContestGuide(db: Db, userId: string, date: string, label: string): Promise<string | null> {
  const id = contestGuideId(userId, date, label);
  if (await db.prepare("SELECT 1 AS x FROM guides WHERE id = ?").bind(id).first()) return id;
  const { results } = await db
    .prepare("SELECT id, title FROM guides WHERE user_id = ? AND election_date = ? AND origin = 'ballot'")
    .bind(userId, date)
    .all<{ id: string; title: string }>();
  return results.find((g) => normalizeLabel(g.title) === normalizeLabel(label))?.id ?? null;
}

/** Adds a queued guide for each contest not already tracked. Returns the ids that are new. */
export async function addContestGuides(db: Db, userId: string, contests: BallotContests, now: number): Promise<string[]> {
  const added: string[] = [];
  for (const election of contests.elections) {
    for (const contest of election.contests) {
      const kind = contest.kind ?? "office";
      const existing = await existingContestGuide(db, userId, election.date, contest.label);
      if (existing) {
        // Guides found before levels were recorded get sorted into their tab now.
        await db.prepare("UPDATE guides SET level = ?, kind = ? WHERE id = ? AND level IS NULL").bind(contest.level, kind, existing).run();
        continue;
      }
      const id = contestGuideId(userId, election.date, contest.label);
      await db
        .prepare(
          `INSERT INTO guides (id, user_id, title, election_date, election_name, data, updated_at, origin, status, query, level, kind)
           VALUES (?, ?, ?, ?, ?, 'null', ?, 'ballot', 'queued', ?, ?, ?)`,
        )
        .bind(id, userId, contest.label, election.date, election.name, now, contest.query, contest.level, kind)
        .run();
      added.push(id);
    }
  }
  return added;
}
