import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { Intent } from "./link";

/** Ballotwise as a confidential client of accounts.xanom.co (xanom-accounts SPEC §2). */
export type XanomConfig = { issuer: string; clientId: string; clientSecret: string; redirectUri: string };

export type Platform = "web" | "ios";

/** What the start route remembers for the callback, in a signed cookie. */
export type Flow = {
  state: string;
  verifier: string;
  nonce: string;
  intent: Intent;
  platform: Platform;
  returnTo: string;
  /** The Ballotwise user who started a link or convert. */
  userId: string | null;
  exp: number;
};

export const FLOW_COOKIE = "bw_xanom_flow";
export const FLOW_TTL_MS = 10 * 60 * 1000;
const CONVERT_TTL_S = 300;

const random = () => randomBytes(32).toString("base64url");

/** Only same-site paths, so the callback can't be turned into an open redirect. */
export function safeReturn(path: string | null | undefined, fallback = "/"): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  return path;
}

export function newFlow(intent: Intent, platform: Platform, returnTo: string, userId: string | null, now: number): Flow {
  return { state: random(), verifier: random(), nonce: random(), intent, platform, returnTo: safeReturn(returnTo), userId, exp: now + FLOW_TTL_MS };
}

// The cookie key is derived from the client secret, so there is no second secret to manage.
const cookieKey = (secret: string) => createHmac("sha256", secret).update("ballotwise xanom flow cookie v1").digest();
const mac = (secret: string, body: string) => createHmac("sha256", cookieKey(secret)).update(body).digest("base64url");

export function sealFlow(flow: Flow, secret: string): string {
  const body = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

const flowSchema = z.object({
  state: z.string().min(16),
  verifier: z.string().min(43),
  nonce: z.string().min(16),
  intent: z.enum(["signin", "link", "convert"]),
  platform: z.enum(["web", "ios"]),
  returnTo: z.string(),
  userId: z.string().nullable(),
  exp: z.number(),
});

/** The flow from a cookie, or null if it was tampered with or expired. */
export function openFlow(value: string | undefined, secret: string, now: number): Flow | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const flow = flowSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    return flow.exp > now ? { ...flow, returnTo: safeReturn(flow.returnTo) } : null;
  } catch {
    return null;
  }
}

/** True when the state the issuer echoed back is the one this browser started with. */
export function stateMatches(flow: Flow, state: string | null): boolean {
  if (!state) return false;
  const a = Buffer.from(flow.state);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const codeChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function authorizeUrl(config: XanomConfig, flow: Flow, extra: { convert?: string; loginHint?: string } = {}): string {
  const url = new URL("/oauth/authorize", config.issuer);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: codeChallenge(flow.verifier),
    code_challenge_method: "S256",
  };
  if (extra.convert) params.convert = extra.convert;
  if (extra.loginHint) params.login_hint = extra.loginHint;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** The convert ticket (SPEC §3): HS256 over the client secret, vouching for the email Ballotwise knows. */
export async function convertTicket(config: XanomConfig, who: { email: string; name: string; emailVerified: boolean }, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ email: who.email, name: who.name, email_verified: who.emailVerified })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.clientId)
    .setAudience(config.issuer)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + CONVERT_TTL_S)
    .sign(new TextEncoder().encode(config.clientSecret));
}

/** Trades the authorization code for tokens and returns the id_token. */
export async function exchangeCode(config: XanomConfig, code: string, verifier: string, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(new URL("/oauth/token", config.issuer), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown };
  if (!res.ok || typeof json.id_token !== "string") throw new Error(`token exchange failed (${res.status}${typeof json.error === "string" ? `, ${json.error}` : ""})`);
  return json.id_token;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

/** The issuer's signing keys. jose refetches them at most every 10 minutes, or sooner for an unknown `kid`. */
export function issuerKeys(issuer: string): JWTVerifyGetKey {
  let keys = jwksCache.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/oauth/jwks", issuer), { cacheMaxAge: 10 * 60 * 1000, timeoutDuration: 3000 });
    jwksCache.set(issuer, keys);
  }
  return keys;
}

const idClaims = z.object({ sub: z.string().min(1), email: z.string().email(), email_verified: z.literal(true), nonce: z.string().optional() });

/** Verifies the id_token's signature, issuer, audience, expiry and nonce, and returns who signed in. */
export async function verifyIdToken(config: XanomConfig, idToken: string, nonce: string, keys: JWTVerifyGetKey): Promise<{ sub: string; email: string }> {
  const { payload } = await jwtVerify(idToken, keys, { issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub"] });
  const claims = idClaims.parse(payload);
  if (claims.nonce !== nonce) throw new Error("id_token nonce mismatch");
  return { sub: claims.sub, email: claims.email.toLowerCase() };
}

/** Verifies the dashboard's summary request JWT (SPEC §4) and returns the Xanom subject it asks about. */
export async function verifySummaryToken(config: Pick<XanomConfig, "issuer" | "clientId">, token: string, keys: JWTVerifyGetKey): Promise<string> {
  const { payload } = await jwtVerify(token, keys, { issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub"] });
  if (payload.scope !== "summary" || typeof payload.sub !== "string") throw new Error("not a summary token");
  return payload.sub;
}
