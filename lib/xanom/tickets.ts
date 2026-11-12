import { hashToken, newToken, type Db } from "../auth/accounts";
import type { Intent, XanomIdentity } from "./link";

export const TICKET_TTL_MS = 60 * 1000;

/**
 * `ios-session`: hands the iOS app a session after a Xanom sign-in.
 * `ios-start`: carries the app's signed-in user into the browser sheet for link and convert.
 * `ios-link`: carries the Xanom identity back from a link or convert; only that same user's app session applies it.
 */
export type TicketKind = "ios-session" | "ios-start" | "ios-link";

export type PendingLink = XanomIdentity & { intent: Intent };
export type Redeemed = { kind: TicketKind; userId: string; link: PendingLink | null };

export async function issueTicket(db: Db, kind: TicketKind, userId: string, now: number, link: PendingLink | null = null): Promise<string> {
  const ticket = newToken();
  await db.batch([
    db.prepare("DELETE FROM xanom_tickets WHERE expires_at < ?").bind(now),
    db
      .prepare("INSERT INTO xanom_tickets (ticket_hash, kind, user_id, intent, xanom_sub, xanom_email, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(hashToken(ticket), kind, userId, link?.intent ?? null, link?.sub ?? null, link?.email ?? null, now + TICKET_TTL_MS),
  ]);
  return ticket;
}

type Row = { kind: TicketKind; user_id: string; intent: Intent | null; xanom_sub: string | null; xanom_email: string | null; expires_at: number };

/** Uses up a ticket of one of these kinds. Null if it's unknown, expired, already used or of another kind. */
export async function redeemTicket(db: Db, kinds: TicketKind[], ticket: string, now: number): Promise<Redeemed | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket) || kinds.length === 0) return null;
  // DELETE ... RETURNING makes the ticket single-use even when two redemptions race.
  const row = await db
    .prepare(`DELETE FROM xanom_tickets WHERE ticket_hash = ? AND kind IN (${kinds.map(() => "?").join(", ")}) RETURNING kind, user_id, intent, xanom_sub, xanom_email, expires_at`)
    .bind(hashToken(ticket), ...kinds)
    .first<Row>();
  if (!row || row.expires_at <= now) return null;
  const link = row.intent && row.xanom_sub && row.xanom_email ? { intent: row.intent, sub: row.xanom_sub, email: row.xanom_email } : null;
  return { kind: row.kind, userId: row.user_id, link };
}
