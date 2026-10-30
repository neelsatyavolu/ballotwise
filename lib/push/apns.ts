// Sends notifications to Apple Push Notification service with token (JWT) auth.
// APNs only speaks HTTP/2; deployed Workers reach it over HTTP/2 through Cloudflare's network, but local `wrangler dev` can't.

export type ApnsConfig = { key: string; keyId: string; teamId: string; topic: string };
export type Environment = "sandbox" | "production";
export type Push = { token: string; environment: Environment; title: string; body: string; threadId: string; raceId?: number; collapseId?: string };
/**
 * `gone` means the token will never work again (uninstalled, or the wrong environment) and should be forgotten.
 * `retry` means the failure was on Apple's side or the network's and the same push may go through later.
 */
export type PushResult = { token: string; ok: boolean; gone: boolean; retry: boolean; reason?: string };
/** Keeps the provider token across isolates (the cron job often runs in a fresh one). */
export type TokenStore = { read(): Promise<{ jwt: string; at: number } | null>; write(jwt: string, at: number): Promise<void> };

const HOSTS: Record<Environment, string> = { sandbox: "https://api.sandbox.push.apple.com", production: "https://api.push.apple.com" };
/** Apple accepts a provider token for an hour and rejects refreshing it more than every 20 minutes. */
const TOKEN_TTL_MS = 50 * 60 * 1000;
const GONE_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

let cached: { keyId: string; jwt: string; at: number } | null = null;

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** The .p8 file's contents (PEM, with or without headers and newlines) as PKCS #8 bytes. */
function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** A provider token signed with ES256, reused for TOKEN_TTL_MS from this isolate's memory or `store`. */
export async function providerToken(config: ApnsConfig, now: number, store?: TokenStore): Promise<string> {
  if (cached && cached.keyId === config.keyId && now - cached.at < TOKEN_TTL_MS) return cached.jwt;
  const stored = await store?.read().catch(() => null);
  if (stored && now - stored.at < TOKEN_TTL_MS) {
    cached = { keyId: config.keyId, jwt: stored.jwt, at: stored.at };
    return stored.jwt;
  }
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(config.key), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const unsigned = `${encodeJson({ alg: "ES256", kid: config.keyId })}.${encodeJson({ iss: config.teamId, iat: Math.floor(now / 1000) })}`;
  // WebCrypto returns the raw r||s signature JWS expects.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned)));
  cached = { keyId: config.keyId, jwt: `${unsigned}.${base64url(signature)}`, at: now };
  await store?.write(cached.jwt, now).catch((err) => console.error("push: couldn't store the APNs token:", err));
  return cached.jwt;
}

export function payloadOf(push: Push) {
  return {
    aps: { alert: { title: push.title, body: push.body }, sound: "default", "thread-id": push.threadId, "interruption-level": "time-sensitive" },
    ...(push.raceId !== undefined && { raceId: push.raceId }),
  };
}

async function sendOne(push: Push, config: ApnsConfig, jwt: string): Promise<PushResult> {
  try {
    const res = await fetch(`${HOSTS[push.environment]}/3/device/${push.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": config.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        ...(push.collapseId && { "apns-collapse-id": push.collapseId.slice(0, 64) }),
      },
      body: JSON.stringify(payloadOf(push)),
    });
    if (res.ok) return { token: push.token, ok: true, gone: false, retry: false };
    const reason = ((await res.json().catch(() => null)) as { reason?: string } | null)?.reason ?? String(res.status);
    return { token: push.token, ok: false, gone: res.status === 410 || GONE_REASONS.has(reason), retry: res.status === 429 || res.status >= 500, reason };
  } catch (err) {
    return { token: push.token, ok: false, gone: false, retry: true, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function sendBatch(pushes: readonly Push[], config: ApnsConfig, jwt: string, parallel: number): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (let i = 0; i < pushes.length; i += parallel) {
    results.push(...(await Promise.all(pushes.slice(i, i + parallel).map((p) => sendOne(p, config, jwt)))));
  }
  return results;
}

/**
 * Sends every push, `parallel` at a time, and tries the ones that failed on Apple's or the network's side once more
 * after `retryAfterMs`. Never throws; each result says how its push finally went, in the order given.
 */
export async function sendAll(pushes: readonly Push[], config: ApnsConfig, now: number, opts: { parallel?: number; retryAfterMs?: number; store?: TokenStore } = {}): Promise<PushResult[]> {
  if (pushes.length === 0) return [];
  const { parallel = 25, retryAfterMs = 2000, store } = opts;
  const jwt = await providerToken(config, now, store);
  const first = await sendBatch(pushes, config, jwt, parallel);
  const again = first.flatMap((r, i) => (r.retry ? [i] : []));
  if (again.length === 0) return first;
  await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  const second = await sendBatch(again.map((i) => pushes[i]), config, jwt, parallel);
  return first.map((r, i) => (r.retry ? second[again.indexOf(i)] : r));
}
