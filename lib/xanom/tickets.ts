import { hashToken, newToken, type Db } from "../auth/accounts";

export const TICKET_TTL_MS = 60 * 1000;

/** `ios-session`: hands the iOS app a session after Xanom sign-in. `ios-start`: carries the app's user into the browser. */
export type TicketKind = "ios-session" | "ios-start";

export async function issueTicket(db: Db, kind: TicketKind, userId: string, now: number): Promise<string> {
  const ticket = newToken();
  await db.batch([
    db.prepare("DELETE FROM xanom_tickets WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO xanom_tickets (ticket_hash, kind, user_id, expires_at) VALUES (?, ?, ?, ?)").bind(hashToken(ticket), kind, userId, now + TICKET_TTL_MS),
  ]);
  return ticket;
}

/** Uses up a ticket of this kind and returns its user id, or null if it's unknown, expired, used or of another kind. */
export async function redeemTicket(db: Db, kind: TicketKind, ticket: string, now: number): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  const hash = hashToken(ticket);
  // DELETE ... RETURNING makes the ticket single-use even when two redemptions race.
  const row = await db
    .prepare("DELETE FROM xanom_tickets WHERE ticket_hash = ? AND kind = ? RETURNING user_id, expires_at")
    .bind(hash, kind)
    .first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at <= now) return null;
  return row.user_id;
}
