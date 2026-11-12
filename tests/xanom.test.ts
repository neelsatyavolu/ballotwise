import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { finishReset, deleteAccount, requestReset, signIn, signUp, userForSession, type Db } from "../lib/auth/accounts";
import { completeCallback } from "../lib/xanom/callback";
import {
  authorizeUrl,
  codeChallenge,
  convertTicket,
  newFlow,
  openFlow,
  safeReturn,
  sealFlow,
  stateMatches,
  verifySummaryToken,
  type Flow,
  type XanomConfig,
} from "../lib/xanom/flow";
import { linkXanom, xanomStatus } from "../lib/xanom/link";
import { xanomSummary } from "../lib/xanom/summary";
import { issueTicket, redeemTicket, TICKET_TTL_MS } from "../lib/xanom/tickets";
import { testDb } from "./sqlite-db";

const NOW = 1_800_000_000_000;
const ISSUER = "https://accounts.test";
const CONFIG: XanomConfig = { issuer: ISSUER, clientId: "ballotwise", clientSecret: "test-client-secret-test-client-secret", redirectUri: "https://ballotwise.test/api/xanom/callback" };

// A fake accounts.xanom.co: an RS256 key behind a local JWKS, plus a stranger's key for bad signatures.
let signingKey: CryptoKey;
let strangerKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  strangerKey = (await generateKeyPair("RS256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

type Claims = Record<string, unknown>;
const sec = (ms: number) => Math.floor(ms / 1000);

async function signed(claims: Claims, opts: { key?: CryptoKey; aud?: string; iss?: string; iat?: number; exp?: number } = {}): Promise<string> {
  const iat = opts.iat ?? sec(Date.now());
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? CONFIG.clientId)
    .setIssuedAt(iat)
    .setExpirationTime(opts.exp ?? iat + 600)
    .sign(opts.key ?? signingKey);
}

const idToken = (flow: Flow, who: { sub: string; email: string }, extra: Claims = {}, opts = {}) =>
  signed({ sub: who.sub, email: who.email, email_verified: true, name: "Voter", nonce: flow.nonce, ...extra }, opts);

/** A token endpoint that checks the PKCE verifier and client secret, then returns `token`. */
function tokenEndpoint(flow: Flow, token: string | Promise<string>): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    if (body.get("code_verifier") !== flow.verifier || body.get("client_secret") !== CONFIG.clientSecret || body.get("code") !== "the-code") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    return new Response(JSON.stringify({ id_token: await token, access_token: "x", token_type: "Bearer", expires_in: 600 }));
  }) as typeof fetch;
}

async function runCallback(db: Db, flow: Flow, token: string, params: Record<string, string> = {}, sessionUserId: string | null = flow.userId) {
  const query = new URLSearchParams({ code: "the-code", state: flow.state, ...params });
  return completeCallback(
    { db, config: CONFIG, keys, fetcher: tokenEndpoint(flow, token), now: Date.now(), sessionUserId },
    sealFlow(flow, CONFIG.clientSecret),
    query,
  );
}

const userRow = (db: Db, email: string) =>
  db.prepare("SELECT id, password_hash, xanom_sub, xanom_email, email_verified_at FROM users WHERE email = ?").bind(email).first<{
    id: string;
    password_hash: string;
    xanom_sub: string | null;
    xanom_email: string | null;
    email_verified_at: number | null;
  }>();

describe("linking rules", () => {
  it("rule 1: signs in as the user who already has the sub", async () => {
    const db = testDb();
    const created = await linkXanom(db, { sub: "xa_1", email: "a@example.com" }, "signin", null, NOW);
    const again = await linkXanom(db, { sub: "xa_1", email: "changed@example.com" }, "signin", null, NOW);
    expect(again.id).toBe(created.id);
  });

  it("rule 2: link attaches the sub to the signed-in user, even under another email", async () => {
    const db = testDb();
    const { user } = await signUp(db, "voter@example.com", "a long password", NOW);
    const linked = await linkXanom(db, { sub: "xa_2", email: "other@example.com" }, "link", user.id, NOW);
    expect(linked.id).toBe(user.id);
    expect(await xanomStatus(db, user.id)).toEqual({ xanom: { email: "other@example.com" }, hasPassword: true, emailVerified: false });
  });

  it("rule 2: convert needs the same email", async () => {
    const db = testDb();
    const { user } = await signUp(db, "voter@example.com", "a long password", NOW);
    await expect(linkXanom(db, { sub: "xa_3", email: "other@example.com" }, "convert", user.id, NOW)).rejects.toMatchObject({ code: "email-mismatch" });
    const ok = await linkXanom(db, { sub: "xa_3", email: "VOTER@example.com" }, "convert", user.id, NOW);
    expect(ok.id).toBe(user.id);
    expect((await userRow(db, "voter@example.com"))?.xanom_sub).toBe("xa_3");
  });

  it("rule 2: refuses a sub that is already on another user, or a user already linked elsewhere", async () => {
    const db = testDb();
    const a = await signUp(db, "a@example.com", "a long password", NOW);
    const b = await signUp(db, "b@example.com", "a long password", NOW);
    await linkXanom(db, { sub: "xa_a", email: "a@example.com" }, "link", a.user.id, NOW);
    await expect(linkXanom(db, { sub: "xa_a", email: "a@example.com" }, "link", b.user.id, NOW)).rejects.toMatchObject({ code: "linked-elsewhere" });
    await expect(linkXanom(db, { sub: "xa_other", email: "x@example.com" }, "link", a.user.id, NOW)).rejects.toMatchObject({ code: "already-linked" });
    // Linking the same pair again is a no-op.
    expect((await linkXanom(db, { sub: "xa_a", email: "a@example.com" }, "link", a.user.id, NOW)).id).toBe(a.user.id);
  });

  it("rule 3 + guard: an unverified password account with the same email loses its password and sessions", async () => {
    const db = testDb();
    const squatter = await signUp(db, "victim@example.com", "attacker password", NOW);
    const user = await linkXanom(db, { sub: "xa_v", email: "victim@example.com" }, "signin", null, NOW);
    expect(user.id).toBe(squatter.user.id);
    const row = await userRow(db, "victim@example.com");
    expect(row).toMatchObject({ password_hash: "", xanom_sub: "xa_v", email_verified_at: NOW });
    expect(await userForSession(db, squatter.token, NOW)).toBeNull();
    await expect(signIn(db, "victim@example.com", "attacker password", NOW)).rejects.toMatchObject({ status: 401 });
  });

  it("rule 3: a verified account keeps its password and sessions", async () => {
    const db = testDb();
    await signUp(db, "voter@example.com", "first password", NOW);
    const reset = await requestReset(db, "voter@example.com", NOW);
    const { token } = await finishReset(db, reset!.token, "second password", NOW);
    await linkXanom(db, { sub: "xa_ok", email: "voter@example.com" }, "signin", null, NOW + 1);
    expect(await userForSession(db, token, NOW + 1)).not.toBeNull();
    expect((await signIn(db, "voter@example.com", "second password", NOW + 1)).user.email).toBe("voter@example.com");
  });

  it("rule 4: creates a password-less user", async () => {
    const db = testDb();
    const user = await linkXanom(db, { sub: "xa_new", email: "New@Example.com" }, "signin", null, NOW);
    expect(user.email).toBe("new@example.com");
    expect(await xanomStatus(db, user.id)).toEqual({ xanom: { email: "new@example.com" }, hasPassword: false, emailVerified: true });
    await expect(signIn(db, "new@example.com", "", NOW)).rejects.toMatchObject({ status: 401 });
  });

  it("a password-less account deletes by typing its email", async () => {
    const db = testDb();
    const user = await linkXanom(db, { sub: "xa_del", email: "del@example.com" }, "signin", null, NOW);
    await expect(deleteAccount(db, user.id, "")).rejects.toMatchObject({ status: 401 });
    await deleteAccount(db, user.id, "DEL@example.com");
    expect(await userRow(db, "del@example.com")).toBeNull();
  });
});

describe("flow cookie, state and PKCE", () => {
  it("round-trips and rejects tampering, another key, and expiry", () => {
    const flow = newFlow("signin", "web", "/ballot", null, NOW);
    const sealed = sealFlow(flow, CONFIG.clientSecret);
    expect(openFlow(sealed, CONFIG.clientSecret, NOW)).toEqual(flow);
    const [body, sig] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...flow, userId: "someone" })).toString("base64url");
    expect(openFlow(`${forged}.${sig}`, CONFIG.clientSecret, NOW)).toBeNull();
    expect(openFlow(`${body}.${sig}x`, CONFIG.clientSecret, NOW)).toBeNull();
    expect(openFlow(sealed, "another secret", NOW)).toBeNull();
    expect(openFlow(sealed, CONFIG.clientSecret, flow.exp)).toBeNull();
    expect(openFlow(undefined, CONFIG.clientSecret, NOW)).toBeNull();
  });

  it("matches state exactly", () => {
    const flow = newFlow("signin", "web", "/", null, NOW);
    expect(stateMatches(flow, flow.state)).toBe(true);
    expect(stateMatches(flow, `${flow.state}x`)).toBe(false);
    expect(stateMatches(flow, null)).toBe(false);
  });

  it("builds the authorize URL with S256 PKCE, nonce and the convert ticket", () => {
    const flow = newFlow("convert", "web", "/account", "u1", NOW);
    const url = new URL(authorizeUrl(CONFIG, flow, { convert: "tkt", loginHint: "a@example.com" }));
    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "ballotwise",
      redirect_uri: CONFIG.redirectUri,
      scope: "openid email profile",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: codeChallenge(flow.verifier),
      code_challenge_method: "S256",
      convert: "tkt",
      login_hint: "a@example.com",
    });
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("only returns to same-site paths", () => {
    expect(safeReturn("/guide/1?x=1")).toBe("/guide/1?x=1");
    expect(safeReturn("//evil.example")).toBe("/");
    expect(safeReturn("/\\evil.example")).toBe("/");
    expect(safeReturn("https://evil.example", "/account")).toBe("/account");
    for (const sneaky of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\u0000x"]) expect(safeReturn(sneaky)).toBe("/");
    expect(safeReturn("/a/../guide?x=1#top")).toBe("/guide?x=1#top");
  });
});

describe("callback", () => {
  const who = { sub: "xa_cb", email: "cb@example.com" };

  it("signs in on the web", async () => {
    const db = testDb();
    const flow = newFlow("signin", "web", "/ballot", null, Date.now());
    const result = await runCallback(db, flow, await idToken(flow, who));
    expect(result).toMatchObject({ ok: true, platform: "web", returnTo: "/ballot" });
  });

  it("rejects a state mismatch, a wrong nonce, wrong aud, wrong iss, expired, bad signature and unverified email", async () => {
    const db = testDb();
    const flow = newFlow("signin", "web", "/", null, Date.now());
    const now = sec(Date.now());
    expect(await runCallback(db, flow, await idToken(flow, who), { state: "nope" })).toMatchObject({ ok: false, code: "state" });
    const bad = [
      await idToken(flow, who, { nonce: "other" }),
      await idToken(flow, who, {}, { aud: "mullwell" }),
      await idToken(flow, who, {}, { iss: "https://evil.example" }),
      await idToken(flow, who, {}, { iat: now - 1200, exp: now - 600 }),
      await idToken(flow, who, {}, { key: strangerKey }),
      await idToken(flow, who, { email_verified: false }),
    ];
    for (const token of bad) expect(await runCallback(db, flow, token)).toMatchObject({ ok: false, code: "failed" });
    expect(await userRow(db, "cb@example.com")).toBeNull();
  });

  it("fails without a flow cookie and passes on a denied sign-in", async () => {
    const db = testDb();
    const flow = newFlow("signin", "web", "/", null, Date.now());
    const none = await completeCallback({ db, config: CONFIG, keys, now: Date.now(), sessionUserId: null }, undefined, new URLSearchParams({ code: "c", state: flow.state }));
    expect(none).toMatchObject({ ok: false, code: "expired" });
    expect(await runCallback(db, flow, "", { error: "access_denied" })).toMatchObject({ ok: false, code: "cancelled" });
  });

  it("links on the web only while the voter who started is still signed in", async () => {
    const db = testDb();
    const { user } = await signUp(db, "mine@example.com", "a long password", NOW);
    const flow = newFlow("link", "web", "/account", user.id, Date.now());
    const token = await idToken(flow, who);
    expect(await runCallback(db, flow, token, {}, null)).toMatchObject({ ok: false, code: "signed-out" });
    expect((await userRow(db, "mine@example.com"))?.xanom_sub).toBeNull();
    expect(await runCallback(db, flow, token)).toMatchObject({ ok: true, platform: "web", userId: user.id, signIn: false, returnTo: "/account?xanom=linked" });
    expect((await userRow(db, "mine@example.com"))?.xanom_sub).toBe("xa_cb");
  });

  it("on iOS, link returns the identity in a ticket instead of linking in the browser", async () => {
    const db = testDb();
    const { user } = await signUp(db, "mine@example.com", "a long password", NOW);
    const flow = newFlow("link", "ios", "/account", user.id, Date.now());
    const result = await runCallback(db, flow, await idToken(flow, who), {}, null);
    if (!result.ok || result.platform !== "ios") throw new Error("expected an iOS ticket");
    expect((await userRow(db, "mine@example.com"))?.xanom_sub).toBeNull();
    expect(await redeemTicket(db, ["ios-session"], result.ticket, Date.now())).toBeNull();
    expect(await redeemTicket(db, ["ios-session", "ios-link"], result.ticket, Date.now())).toEqual({
      kind: "ios-link",
      userId: user.id,
      link: { intent: "link", sub: "xa_cb", email: "cb@example.com" },
    });
  });

  it("reports a refused convert to the account page", async () => {
    const db = testDb();
    const { user } = await signUp(db, "mine@example.com", "a long password", NOW);
    const flow = newFlow("convert", "web", "/account", user.id, Date.now());
    expect(await runCallback(db, flow, await idToken(flow, who))).toMatchObject({ ok: false, intent: "convert", code: "email-mismatch" });
  });

  it("hands iOS a one-time ticket bound to the iOS session kind", async () => {
    const db = testDb();
    const flow = newFlow("signin", "ios", "/", null, Date.now());
    const result = await runCallback(db, flow, await idToken(flow, who));
    if (!result.ok || result.platform !== "ios") throw new Error("expected an iOS ticket");
    expect(await redeemTicket(db, ["ios-start"], result.ticket, Date.now())).toBeNull();
    const redeemed = await redeemTicket(db, ["ios-session", "ios-link"], result.ticket, Date.now());
    expect(redeemed).toEqual({ kind: "ios-session", userId: (await userRow(db, "cb@example.com"))?.id, link: null });
    expect(await redeemTicket(db, ["ios-session"], result.ticket, Date.now())).toBeNull();
  });
});

describe("iOS tickets", () => {
  it("expire after 60 seconds and reject junk", async () => {
    const db = testDb();
    const { user } = await signUp(db, "t@example.com", "a long password", NOW);
    const ticket = await issueTicket(db, "ios-start", user.id, NOW);
    expect(await redeemTicket(db, ["ios-start"], ticket, NOW + TICKET_TTL_MS)).toBeNull();
    expect(await redeemTicket(db, ["ios-start"], "not a ticket", NOW)).toBeNull();
  });
});

describe("convert ticket", () => {
  it("is HS256 over the client secret with the spec's claims", async () => {
    const token = await convertTicket(CONFIG, { email: "v@example.com", name: "", emailVerified: true }, NOW);
    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(CONFIG.clientSecret), {
      issuer: "ballotwise",
      audience: ISSUER,
      currentDate: new Date(NOW),
    });
    expect(protectedHeader).toEqual({ alg: "HS256", typ: "JWT" });
    expect(payload).toMatchObject({ email: "v@example.com", name: "", email_verified: true, iat: sec(NOW), exp: sec(NOW) + 300 });
    expect(typeof payload.jti).toBe("string");
    await expect(jwtVerify(token, new TextEncoder().encode("wrong"), { currentDate: new Date(NOW) })).rejects.toThrow();
  });
});

describe("summary endpoint", () => {
  const summaryToken = (opts: Parameters<typeof signed>[1] = {}, scope = "summary") => signed({ sub: "xa_s", scope }, opts);

  it("verifies a good token and rejects wrong aud, expired, bad signature and other scopes", async () => {
    expect(await verifySummaryToken(CONFIG, await summaryToken(), keys)).toBe("xa_s");
    const now = sec(Date.now());
    for (const token of [
      await summaryToken({ aud: "tare" }),
      await summaryToken({ iat: now - 120, exp: now - 60 }),
      await summaryToken({ key: strangerKey }),
      await summaryToken({}, "openid"),
      "not.a.jwt",
    ]) {
      await expect(verifySummaryToken(CONFIG, token, keys)).rejects.toThrow();
    }
  });

  it("counts guides, stars and dashboards and lists recent guides", async () => {
    const db = testDb();
    expect(await xanomSummary(db, "xa_s", "https://bw.test")).toEqual({ linked: false });
    const user = await linkXanom(db, { sub: "xa_s", email: "s@example.com" }, "signin", null, NOW);
    for (let i = 0; i < 4; i++) {
      await db.prepare("INSERT INTO guides (id, user_id, title, data, updated_at) VALUES (?, ?, ?, '{}', ?)").bind(`g${i}`, user.id, `Race ${i}`, NOW + i).run();
    }
    await db.prepare("INSERT INTO midterm_favorites (user_id, race_id, created_at) VALUES (?, 1, ?)").bind(user.id, NOW).run();
    const summary = await xanomSummary(db, "xa_s", "https://bw.test");
    expect(summary).toEqual({
      linked: true,
      headline: "4 guides · 1 starred race",
      items: [
        { label: "Voter guides", value: "4" },
        { label: "Starred races", value: "1" },
        { label: "Dashboards", value: "0" },
      ],
      recent: [3, 2, 1].map((i) => ({ title: `Race ${i}`, url: `https://bw.test/guide/g${i}`, at: new Date(NOW + i).toISOString() })),
      url: "https://bw.test/",
    });
  });
});
