import { randomUUID } from "node:crypto";
import { AccountError, type Db, type User } from "../auth/accounts";

export type Intent = "signin" | "link" | "convert";

/** The verified claims from a Xanom id_token that linking needs. */
export type XanomIdentity = { sub: string; email: string };

/** Why a link was refused; the code travels in the redirect and the app shows its own wording for it. */
export type LinkErrorCode = "linked-elsewhere" | "already-linked" | "email-mismatch" | "signed-out";

export class LinkError extends AccountError {
  constructor(readonly code: LinkErrorCode, message: string) {
    super(message, code === "signed-out" ? 401 : 409);
  }
}

type Row = { id: string; email: string; password_hash: string; xanom_sub: string | null; email_verified_at: number | null };

const byId = (db: Db, id: string) =>
  db.prepare("SELECT id, email, password_hash, xanom_sub, email_verified_at FROM users WHERE id = ?").bind(id).first<Row>();

async function attach(db: Db, userId: string, who: XanomIdentity): Promise<void> {
  await db.prepare("UPDATE users SET xanom_sub = ?, xanom_email = ? WHERE id = ?").bind(who.sub, who.email, userId).run();
}

/**
 * Applies the Xanom linking rules (xanom-accounts SPEC §2) and returns the user to sign in as.
 * `currentUserId` is the Ballotwise user signed in when the flow started (only used for link and convert).
 *
 * 1. Someone already has this sub: sign in as them. For link/convert by a different signed-in user, refuse.
 * 2. link/convert with a signed-in user: attach the sub (convert also needs the same email).
 * 3. Someone has the same email: attach and sign in. If Ballotwise never verified that address and the account
 *    has a password, the password and every session are revoked first (account pre-hijacking guard).
 * 4. Otherwise create a new account with no password.
 */
export async function linkXanom(db: Db, who: XanomIdentity, intent: Intent, currentUserId: string | null, now: number): Promise<User> {
  const email = who.email.trim().toLowerCase();
  const identity = { sub: who.sub, email };
  const owner = await db.prepare("SELECT id, email FROM users WHERE xanom_sub = ?").bind(who.sub).first<User>();

  if (intent !== "signin" && currentUserId) {
    if (owner && owner.id !== currentUserId) throw new LinkError("linked-elsewhere", "That Xanom account is already linked to a different Ballotwise account.");
    const current = await byId(db, currentUserId);
    if (!current) throw new LinkError("signed-out", "Your Ballotwise session ended. Sign in and try again.");
    if (owner) return { id: current.id, email: current.email };
    if (current.xanom_sub) throw new LinkError("already-linked", "This Ballotwise account is already linked to a different Xanom account.");
    if (intent === "convert" && current.email.toLowerCase() !== email) {
      throw new LinkError("email-mismatch", "That Xanom account uses a different email. Use \"Link an existing Xanom account\" instead.");
    }
    await attach(db, current.id, identity);
    return { id: current.id, email: current.email };
  }

  if (owner) return owner;

  const same = await db.prepare("SELECT id, email, password_hash, xanom_sub, email_verified_at FROM users WHERE email = ?").bind(email).first<Row>();
  if (same) {
    if (same.xanom_sub) throw new LinkError("already-linked", "The Ballotwise account with this email is linked to a different Xanom account.");
    const statements = [];
    if (same.email_verified_at === null && same.password_hash !== "") {
      // Someone may have signed up with this address before its owner did. The owner just proved it through
      // Xanom, so the old password and any sessions it opened stop working. A password reset sets a new one.
      statements.push(
        db.prepare("UPDATE users SET password_hash = '' WHERE id = ?").bind(same.id),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(same.id),
        db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(same.id),
      );
    }
    statements.push(
      db.prepare("UPDATE users SET xanom_sub = ?, xanom_email = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").bind(who.sub, email, now, same.id),
    );
    await db.batch(statements);
    return { id: same.id, email: same.email };
  }

  const user = { id: randomUUID(), email };
  await db
    .prepare("INSERT INTO users (id, email, password_hash, created_at, xanom_sub, xanom_email, email_verified_at) VALUES (?, ?, '', ?, ?, ?, ?)")
    .bind(user.id, email, now, who.sub, email, now)
    .run();
  return user;
}

/** What the account page shows about Xanom and the password. */
export async function xanomStatus(db: Db, userId: string): Promise<{ xanom: { email: string } | null; hasPassword: boolean; emailVerified: boolean }> {
  const row = await db
    .prepare("SELECT password_hash, xanom_sub, xanom_email, email_verified_at FROM users WHERE id = ?")
    .bind(userId)
    .first<{ password_hash: string; xanom_sub: string | null; xanom_email: string | null; email_verified_at: number | null }>();
  return {
    xanom: row?.xanom_sub ? { email: row.xanom_email ?? "" } : null,
    hasPassword: !!row && row.password_hash !== "",
    emailVerified: row?.email_verified_at != null,
  };
}
