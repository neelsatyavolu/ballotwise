import { createHash } from "node:crypto";
import type { Db } from "../auth/accounts";
import type { BallotContests } from "../schema";
import type { Districts } from "./census";

export type BallotStatus = "finding" | "ready" | "failed";
export type Ballot = { address: string; matchedAddress: string; districts: Districts; status: BallotStatus; error: string | null; updatedAt: number };

export async function saveBallot(db: Db, userId: string, address: string, matchedAddress: string, districts: Districts, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ballots (user_id, address, matched_address, districts, status, error, updated_at) VALUES (?, ?, ?, ?, 'finding', NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET address = excluded.address, matched_address = excluded.matched_address,
         districts = excluded.districts, status = 'finding', error = NULL, updated_at = excluded.updated_at`,
    )
    .bind(userId, address, matchedAddress, JSON.stringify(districts), now)
    .run();
}

export async function getBallot(db: Db, userId: string): Promise<Ballot | null> {
  const row = await db
    .prepare("SELECT address, matched_address AS matchedAddress, districts, status, error, updated_at AS updatedAt FROM ballots WHERE user_id = ?")
    .bind(userId)
    .first<Omit<Ballot, "districts"> & { districts: string }>();
  return row ? { ...row, districts: JSON.parse(row.districts) as Districts } : null;
}

export async function setBallotStatus(db: Db, userId: string, status: BallotStatus, error: string | null, now: number): Promise<void> {
  await db.prepare("UPDATE ballots SET status = ?, error = ?, updated_at = ? WHERE user_id = ?").bind(status, error, now, userId).run();
}

/** Same contest, same id: finding contests again never duplicates a guide or loses answers already given. */
export function contestGuideId(userId: string, date: string, label: string): string {
  const key = `${userId}|${date}|${label.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return `b${createHash("sha256").update(key).digest("base64url").slice(0, 21)}`;
}

/** Adds a queued guide for each contest not already tracked. Returns the ids that are new. */
export async function addContestGuides(db: Db, userId: string, contests: BallotContests, now: number): Promise<string[]> {
  const added: string[] = [];
  for (const election of contests.elections) {
    for (const contest of election.contests) {
      const id = contestGuideId(userId, election.date, contest.label);
      const exists = await db.prepare("SELECT 1 AS x FROM guides WHERE id = ?").bind(id).first();
      if (exists) continue;
      await db
        .prepare(
          `INSERT INTO guides (id, user_id, title, election_date, election_name, data, updated_at, origin, status, query)
           VALUES (?, ?, ?, ?, ?, 'null', ?, 'ballot', 'queued', ?)`,
        )
        .bind(id, userId, contest.label, election.date, election.name, now, contest.query)
        .run();
      added.push(id);
    }
  }
  return added;
}
