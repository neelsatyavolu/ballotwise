import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "./password";

/** The slice of Cloudflare D1 this module uses, so tests can run it on SQLite. */
export type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
export type Db = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown> };

export type User = { id: string; email: string };

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
const SIGNIN_FAILURES_ALLOWED = 10;
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const RESETS_ALLOWED = 3;
const RESET_WINDOW_MS = 60 * 60 * 1000;

/** 256 random bits, as the browser or the email link carries it. Only its hash is stored. */
export const newToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const attemptKey = (kind: string, email: string) => hashToken(`${kind}:${email.toLowerCase()}`);

export class AccountError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function recentAttempts(db: Db, key: string, windowMs: number, now: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key_hash = ? AND created_at > ?").bind(key, now - windowMs).first<{ n: number }>();
  return row?.n ?? 0;
}

async function recordAttempt(db: Db, key: string, now: number): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO attempts (key_hash, created_at) VALUES (?, ?)").bind(key, now),
    // Old rows only ever fall out of every window, so pruning here keeps the table small.
    db.prepare("DELETE FROM attempts WHERE created_at < ?").bind(now - Math.max(SIGNIN_WINDOW_MS, RESET_WINDOW_MS)),
  ]);
}

async function startSession(db: Db, userId: string, now: number): Promise<string> {
  const token = newToken();
  await db.batch([
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(hashToken(token), userId, now + SESSION_TTL_MS),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
  return token;
}

export async function signUp(db: Db, email: string, password: string, now: number): Promise<{ user: User; token: string }> {
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) throw new AccountError("An account with that email already exists. Sign in instead.", 409);
  const user = { id: randomUUID(), email };
  await db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").bind(user.id, email, await hashPassword(password), now).run();
  return { user, token: await startSession(db, user.id, now) };
}

export async function signIn(db: Db, email: string, password: string, now: number): Promise<{ user: User; token: string }> {
  const key = attemptKey("signin", email);
  if ((await recentAttempts(db, key, SIGNIN_WINDOW_MS, now)) >= SIGNIN_FAILURES_ALLOWED) {
    throw new AccountError("Too many tries. Wait 15 minutes, or reset your password.", 429);
  }
  const row = await db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").bind(email).first<{ id: string; email: string; password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    await recordAttempt(db, key, now);
    throw new AccountError("That email and password don't match.", 401);
  }
  return { user: { id: row.id, email: row.email }, token: await startSession(db, row.id, now) };
}

export async function userForSession(db: Db, token: string, now: number): Promise<User | null> {
  return db
    .prepare("SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(hashToken(token), now)
    .first<User>();
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hashToken(token)).run();
}

/**
 * Makes a one-hour reset link token for the account with this email, replacing any earlier link.
 * Null when there is no such account or it asked too often; callers answer the same either way.
 */
export async function requestReset(db: Db, email: string, now: number): Promise<{ email: string; token: string } | null> {
  const key = attemptKey("reset", email);
  if ((await recentAttempts(db, key, RESET_WINDOW_MS, now)) >= RESETS_ALLOWED) return null;
  await recordAttempt(db, key, now);
  const user = await db.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first<User>();
  if (!user) return null;
  const token = newToken();
  await db.batch([
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id),
    db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(hashToken(token), user.id, now + RESET_TTL_MS),
  ]);
  return { email: user.email, token };
}

/** Uses up a reset token, sets the new password, signs out every session, and returns a fresh one. */
export async function finishReset(db: Db, token: string, password: string, now: number): Promise<{ user: User; token: string }> {
  const hash = hashToken(token);
  const row = await db
    .prepare("SELECT u.id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > ?")
    .bind(hash, now)
    .first<User>();
  if (!row) throw new AccountError("This reset link has expired or was already used. Ask for a new one.", 400);
  await db.batch([
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(row.id),
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), row.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id),
  ]);
  return { user: row, token: await startSession(db, row.id, now) };
}
