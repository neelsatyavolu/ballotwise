import type { Db } from "../auth/accounts";
import { seal, unseal as unsealSession, type DdhqSession } from "./vault";

export type DdhqPending = { clientToken: string; signInId: string; emailAddressId: string };

const TEN_MINUTES = 10 * 60 * 1000;

async function unsealPending(sealed: string, keyB64: string, userId: string): Promise<DdhqPending | null> {
  const session = await unsealSession(sealed, keyB64, userId);
  if (session) return null;
  // Pending blobs are a different shape, so unseal them with the same key without the session check.
  const [iv, cipher] = sealed.split(".");
  if (!iv || !cipher) return null;
  try {
    const params = { name: "AES-GCM", iv: Buffer.from(iv, "base64url"), additionalData: new TextEncoder().encode(userId) };
    const raw = Buffer.from(keyB64, "base64");
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(params, key, Buffer.from(cipher, "base64url"));
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    if (typeof parsed.clientToken !== "string" || typeof parsed.signInId !== "string" || typeof parsed.emailAddressId !== "string") return null;
    return { clientToken: parsed.clientToken, signInId: parsed.signInId, emailAddressId: parsed.emailAddressId };
  } catch {
    return null;
  }
}

export async function storeDdhqPending(db: Db, keyB64: string, userId: string, email: string, pending: DdhqPending, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ddhq_pending (user_id, sealed, email, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET sealed = excluded.sealed, email = excluded.email, expires_at = excluded.expires_at`,
    )
    .bind(userId, await seal(pending, keyB64, userId), email, now + TEN_MINUTES)
    .run();
}

export async function loadDdhqPending(db: Db, keyB64: string, userId: string, now: number): Promise<{ email: string; pending: DdhqPending } | null> {
  const row = await db.prepare("SELECT sealed, email, expires_at FROM ddhq_pending WHERE user_id = ?").bind(userId).first<{ sealed: string; email: string; expires_at: number }>();
  if (!row || row.expires_at <= now) return null;
  const pending = await unsealPending(row.sealed, keyB64, userId);
  return pending ? { email: row.email, pending } : null;
}

export async function deleteDdhqPending(db: Db, userId: string): Promise<void> {
  await db.prepare("DELETE FROM ddhq_pending WHERE user_id = ?").bind(userId).run();
}

export type { DdhqSession };
