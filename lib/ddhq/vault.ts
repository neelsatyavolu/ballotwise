import type { Db } from "../auth/accounts";

export type DdhqSession = { clientToken: string; sessionId: string };

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = Buffer.from(keyB64, "base64");
  if (raw.length !== 32) throw new Error("GROK_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(session: unknown, keyB64: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) };
  const cipher = await crypto.subtle.encrypt(params, await importKey(keyB64), new TextEncoder().encode(JSON.stringify(session)));
  return `${Buffer.from(iv).toString("base64url")}.${Buffer.from(cipher).toString("base64url")}`;
}

export async function unseal(sealed: string, keyB64: string, userId: string): Promise<DdhqSession | null> {
  const [iv, cipher] = sealed.split(".");
  if (!iv || !cipher) return null;
  try {
    const params = { name: "AES-GCM", iv: Buffer.from(iv, "base64url"), additionalData: new TextEncoder().encode(userId) };
    const plain = await crypto.subtle.decrypt(params, await importKey(keyB64), Buffer.from(cipher, "base64url"));
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    if (typeof parsed.clientToken !== "string" || typeof parsed.sessionId !== "string") return null;
    return { clientToken: parsed.clientToken, sessionId: parsed.sessionId };
  } catch {
    return null;
  }
}

export async function storeDdhqSession(db: Db, keyB64: string, userId: string, email: string, session: DdhqSession, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ddhq_connections (user_id, sealed, email, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET sealed = excluded.sealed, email = excluded.email, updated_at = excluded.updated_at`,
    )
    .bind(userId, await seal(session, keyB64, userId), email, now)
    .run();
}

export async function loadDdhqSession(db: Db, keyB64: string, userId: string): Promise<{ email: string; session: DdhqSession } | null> {
  const row = await db.prepare("SELECT sealed, email FROM ddhq_connections WHERE user_id = ?").bind(userId).first<{ sealed: string; email: string }>();
  if (!row) return null;
  const session = await unseal(row.sealed, keyB64, userId);
  return session ? { email: row.email, session } : null;
}

export async function deleteDdhqSession(db: Db, userId: string): Promise<void> {
  await db.prepare("DELETE FROM ddhq_connections WHERE user_id = ?").bind(userId).run();
}

export async function hasDdhqSession(db: Db, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM ddhq_connections WHERE user_id = ?").bind(userId).first<{ ok: number }>();
  return Boolean(row);
}
