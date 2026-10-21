import type { Db } from "../auth/accounts";
import type { GrokTokens } from "./oauth";

/**
 * The account's AI tokens (Grok or ChatGPT; one connection per account, kept in grok_connections), sealed with AES-GCM under GROK_TOKEN_KEY (32 random bytes, base64).
 * Server-side storage is what lets queued research run after the person closes the tab.
 */
async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = Buffer.from(keyB64, "base64");
  if (raw.length !== 32) throw new Error("GROK_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(tokens: GrokTokens, keyB64: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // The user id is bound as additional data, so a sealed blob can't be moved to another account.
  const params = { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) };
  const cipher = await crypto.subtle.encrypt(params, await importKey(keyB64), new TextEncoder().encode(JSON.stringify(tokens)));
  return `${Buffer.from(iv).toString("base64url")}.${Buffer.from(cipher).toString("base64url")}`;
}

export async function unseal(sealed: string, keyB64: string, userId: string): Promise<GrokTokens | null> {
  const [iv, cipher] = sealed.split(".");
  if (!iv || !cipher) return null;
  try {
    const params = { name: "AES-GCM", iv: Buffer.from(iv, "base64url"), additionalData: new TextEncoder().encode(userId) };
    const plain = await crypto.subtle.decrypt(params, await importKey(keyB64), Buffer.from(cipher, "base64url"));
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string" || typeof parsed.expiresAt !== "number") return null;
    // Connections sealed before ChatGPT support carry no provider; they are all Grok.
    return { ...parsed, provider: parsed.provider === "codex" ? "codex" : "grok" };
  } catch {
    return null;
  }
}

export async function storeGrokTokens(db: Db, keyB64: string, userId: string, tokens: GrokTokens, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO grok_connections (user_id, sealed, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at`,
    )
    .bind(userId, await seal(tokens, keyB64, userId), now)
    .run();
}

export async function loadGrokTokens(db: Db, keyB64: string, userId: string): Promise<GrokTokens | null> {
  const row = await db.prepare("SELECT sealed FROM grok_connections WHERE user_id = ?").bind(userId).first<{ sealed: string }>();
  return row ? unseal(row.sealed, keyB64, userId) : null;
}

export async function deleteGrokTokens(db: Db, userId: string): Promise<void> {
  await db.prepare("DELETE FROM grok_connections WHERE user_id = ?").bind(userId).run();
}

/**
 * Usable tokens for this account, refreshed when close to expiry. Background jobs refresh concurrently,
 * and Grok may rotate refresh tokens, so a failed refresh re-reads the store in case another job already won.
 */
export async function usableGrokTokens(
  db: Db,
  keyB64: string,
  userId: string,
  refresh: (t: GrokTokens) => Promise<GrokTokens>,
  now = Date.now(),
): Promise<GrokTokens | null> {
  const tokens = await loadGrokTokens(db, keyB64, userId);
  if (!tokens) return null;
  if (tokens.expiresAt > now + 60_000) return tokens;
  try {
    const fresh = await refresh(tokens);
    await storeGrokTokens(db, keyB64, userId, fresh, now);
    return fresh;
  } catch (err) {
    const latest = await loadGrokTokens(db, keyB64, userId);
    if (latest && latest.expiresAt > now + 60_000) return latest;
    throw err;
  }
}
