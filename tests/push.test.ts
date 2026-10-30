import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallEvent } from "../lib/midterms/calls";
import { closeWaves } from "../lib/midterms/polls";
import type { Office, RaceSummary } from "../lib/midterms/races";
import { callMessage, callPushes, controlDecided, DIGEST_AFTER, dueWave, undoesFlip, waveMessage, type Alerts, type Device } from "../lib/push/alerts";
import { payloadOf, providerToken, sendAll } from "../lib/push/apns";
import { CONTROL_CONFIRM_MS, dispatchPushes } from "../lib/push/dispatch";
import { listDevices, registerSchema, saveDevice } from "../lib/push/devices";
import { testDb } from "./sqlite-db";

const NOW = Date.parse("2026-11-04T03:00:00Z");
const TOKEN = "a".repeat(64);
const ALL_OFF: Alerts = { starred: false, control: false, allCalls: false, pollClose: false };

function race(id: number, office: Office, state: string, district: number | null = null, title = `${state} race`): RaceSummary {
  return { id, office, state, district, title, reporting: 90, total: 1000, candidates: [], rating: null };
}
function event(id: number, raceId: number, office: Office, winner: string | null, party: string | null, previous: string | null = null): CallEvent {
  return { id, raceId, office, kind: winner === null ? "withdrawal" : previous === null ? "call" : "change", winner, party, previous, at: NOW };
}
const device = (alerts: Partial<Alerts>, starred: number[] = [], token = TOKEN): Device => ({ token, environment: "sandbox", alerts: { ...ALL_OFF, ...alerts }, starred, homeState: null });

describe("call messages", () => {
  // Pennsylvania's Senate seat isn't up; Georgia's (Ossoff, D) is. Governors from holders.ts: AZ is D, TX is R.
  const ga = race(1, "senate", "GA");
  it("says who won", () => {
    const m = callMessage(event(1, 1, "senate", "Jon Ossoff", "Democratic"), ga);
    expect(m).toMatchObject({ title: "Called: Georgia Senate", body: "Jon Ossoff (D) wins.", raceId: 1, threadId: "race-1" });
  });
  it("marks a seat changing party as a flip", () => {
    const m = callMessage(event(2, 2, "governor", "Someone", "Republican"), race(2, "governor", "AZ"));
    expect(m.title).toBe("Flip: Arizona Governor");
    expect(m.body).toBe("Someone (R) wins, taking the seat from Democrats.");
  });
  it("covers changed and withdrawn calls and measures", () => {
    expect(callMessage(event(3, 1, "senate", "Derek Dooley", "Republican", "Jon Ossoff"), ga).title).toBe("Call changed: Georgia Senate");
    expect(callMessage(event(4, 1, "senate", null, null, "Jon Ossoff"), ga).body).toContain("Jon Ossoff was withdrawn");
    expect(callMessage(event(5, 9, "measure", "Yes", "Nonpartisan"), race(9, "measure", "AR", null, "Arkansas Issue 1")).title).toBe("Passed: Issue 1");
  });
});

describe("who gets which call", () => {
  const races = new Map([
    [1, race(1, "senate", "GA")],
    [2, race(2, "governor", "AZ")],
    [3, race(3, "house", "TX", 4)],
    [9, race(9, "measure", "AR")],
  ]);
  const events = [event(1, 1, "senate", "Jon Ossoff", "Democratic"), event(2, 2, "governor", "Someone", "Republican"), event(3, 3, "house", "Pat Fallon", "Republican"), event(4, 9, "measure", "No", "Nonpartisan")];

  it("sends starred races only to devices that starred them", () => {
    const pushes = callPushes(events, races, [device({ starred: true }, [3]), device({ starred: false }, [3], "b".repeat(64))]);
    expect(pushes.map((p) => [p.token[0], p.raceId])).toEqual([["a", 3]]);
  });
  it("sends every partisan call, but not measures, to all-calls devices", () => {
    expect(callPushes(events, races, [device({ allCalls: true })]).map((p) => p.raceId)).toEqual([1, 2, 3]);
  });
  it("sends Senate and governor flips to control devices", () => {
    expect(callPushes(events, races, [device({ control: true })]).map((p) => p.title)).toEqual(["Flip: Arizona Governor"]);
  });
  it("folds a busy run into one summary but keeps starred races separate", () => {
    const many = Array.from({ length: DIGEST_AFTER + 2 }, (_, i) => event(10 + i, 3, "house", `Person ${i}`, "Republican"));
    const pushes = callPushes([...many, events[0]], races, [device({ allCalls: true, starred: true }, [1])]);
    expect(pushes).toHaveLength(2);
    expect(pushes[0].raceId).toBe(1);
    expect(pushes[1].title).toBe(`${DIGEST_AFTER + 2} races called`);
  });
});

describe("one-time alerts", () => {
  const tally = (D: number, R: number, total: number, majority: number) => ({ D, R, other: 0, total, majority, uncalled: total - D - R });
  it("decides a chamber at a majority, Republicans holding the Senate at 50", () => {
    expect(controlDecided({ senate: tally(49, 50, 100, 51), house: tally(200, 210, 435, 218) }).map((c) => c.key)).toEqual(["control:senate:R"]);
    expect(controlDecided({ senate: tally(51, 40, 100, 51), house: tally(218, 0, 435, 218) }).map((c) => c.key)).toEqual(["control:senate:D", "control:house:D"]);
  });
  it("finds the wave that just closed and names the voter's state", () => {
    const eight = closeWaves().find((w) => w.states.some((s) => s.state === "PA"))!;
    expect(dueWave(eight.at - 1)?.at).not.toBe(eight.at);
    expect(dueWave(eight.at + 60_000)).toEqual(eight);
    expect(waveMessage(eight, "PA").title).toBe("Polls are closed in Pennsylvania");
    expect(waveMessage(eight, "MI").title).toBe("Most polls are closed in Michigan");
    expect(waveMessage(eight, null).title).toBe("Polls closing at 8:00 PM ET");
  });
});

async function p8(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

describe("APNs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signs a provider token Apple can verify", async () => {
    const { pem, publicKey } = await p8();
    const jwt = await providerToken({ key: pem, keyId: "KEY1", teamId: "TEAM", topic: "t" }, NOW);
    const [header, claims, sig] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(header)))).toEqual({ alg: "ES256", kid: "KEY1" });
    expect(JSON.parse(new TextDecoder().decode(fromB64url(claims)))).toEqual({ iss: "TEAM", iat: NOW / 1000 });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64url(sig), new TextEncoder().encode(`${header}.${claims}`))).toBe(true);
  });

  it("posts to the right host and flags dead tokens", async () => {
    const { pem } = await p8();
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
      return url.includes("dead") ? new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 }) : new Response(null, { status: 200 });
    });
    const base = { title: "T", body: "B", threadId: "x" };
    const results = await sendAll([{ ...base, token: "live", environment: "production", raceId: 5 }, { ...base, token: "dead", environment: "sandbox" }], { key: pem, keyId: "K2", teamId: "T", topic: "co.xanom.ballotwise" }, NOW);
    expect(calls[0].url).toBe("https://api.push.apple.com/3/device/live");
    expect(calls[1].url).toBe("https://api.sandbox.push.apple.com/3/device/dead");
    expect(calls[0].headers["apns-topic"]).toBe("co.xanom.ballotwise");
    expect(JSON.parse(calls[0].body)).toEqual(payloadOf({ ...base, token: "live", environment: "production", raceId: 5 }));
    expect(results.map((r) => [r.ok, r.gone])).toEqual([[true, false], [false, true]]);
  });
});

describe("dispatch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts from the latest call, then sends only new ones, once, and forgets dead devices", async () => {
    const db = testDb();
    const { pem } = await p8();
    const config = { key: pem, keyId: "K3", teamId: "T", topic: "t" };
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      sent.push(url);
      return url.endsWith("b".repeat(64)) ? new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 }) : new Response(null, { status: 200 });
    });
    const insert = (raceId: number, winner: string) =>
      db.prepare("INSERT INTO midterm_call_events (race_id, office, winner, party, previous, observed_at) VALUES (?, 'senate', ?, 'Democratic', NULL, ?)").bind(raceId, winner, NOW).run();
    const races = [race(1, "senate", "GA"), race(2, "senate", "MI")];
    // Before 6 p.m. ET on Nov 3, so no poll-closing wave is due.
    const quiet = Date.parse("2026-11-03T15:00:00Z");

    await insert(1, "Old call");
    await saveDevice(db, { token: TOKEN, environment: "sandbox", alerts: { ...ALL_OFF, allCalls: true }, starred: [], homeState: null }, null, quiet);
    await saveDevice(db, { token: "b".repeat(64), environment: "sandbox", alerts: { ...ALL_OFF, allCalls: true }, starred: [], homeState: null }, null, quiet);

    expect(await dispatchPushes(db, config, races, quiet)).toEqual({ sent: 0, failed: 0, dropped: 0 });
    await insert(2, "Gary Peters");
    expect(await dispatchPushes(db, config, races, quiet)).toEqual({ sent: 1, failed: 1, dropped: 0 });
    expect(sent).toHaveLength(2);
    expect((await listDevices(db)).map((d) => d.token)).toEqual([TOKEN]);
    expect(await dispatchPushes(db, config, races, quiet)).toEqual({ sent: 0, failed: 0, dropped: 0 });
  });

  it("validates registrations", () => {
    expect(registerSchema.safeParse({ token: "xyz", environment: "sandbox", alerts: ALL_OFF, starred: [], homeState: null }).success).toBe(false);
    expect(registerSchema.safeParse({ token: TOKEN, environment: "prod", alerts: ALL_OFF, starred: [], homeState: null }).success).toBe(false);
    expect(registerSchema.safeParse({ token: TOKEN, environment: "production", alerts: ALL_OFF, starred: [1, 2], homeState: "CA" }).success).toBe(true);
  });
});

describe("hardening", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells control devices when a flip is undone", () => {
    const az = { ...race(2, "governor", "AZ"), candidates: [{ name: "Someone", party: "Republican", votes: 1, pct: 50, winner: false, incumbent: false }] };
    const withdrawn = event(9, 2, "governor", null, null, "Someone");
    expect(undoesFlip(withdrawn, az)).toBe(true);
    expect(callPushes([withdrawn], new Map([[2, az]]), [device({ control: true })]).map((p) => p.title)).toEqual(["Call withdrawn: Arizona Governor"]);
  });

  it("retries a push Apple couldn't take, once", async () => {
    const { pem } = await p8();
    let tries = 0;
    vi.stubGlobal("fetch", async () => (++tries === 1 ? new Response(JSON.stringify({ reason: "ServiceUnavailable" }), { status: 503 }) : new Response(null, { status: 200 })));
    const results = await sendAll([{ token: TOKEN, environment: "sandbox", title: "T", body: "B", threadId: "x" }], { key: pem, keyId: "K4", teamId: "T", topic: "t" }, NOW, { retryAfterMs: 0 });
    expect(tries).toBe(2);
    expect(results[0].ok).toBe(true);
  });

  it("reuses a stored provider token across isolates", async () => {
    const { pem } = await p8();
    const store = { read: vi.fn(async () => ({ jwt: "stored.jwt.token", at: NOW - 60_000 })), write: vi.fn(async () => {}) };
    expect(await providerToken({ key: pem, keyId: "K5", teamId: "T", topic: "t" }, NOW, store)).toBe("stored.jwt.token");
    expect(store.write).not.toHaveBeenCalled();
  });

  it("announces control only once it holds across two runs", async () => {
    const db = testDb();
    const { pem } = await p8();
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (sent.push(url), new Response(null, { status: 200 })));
    await saveDevice(db, { token: TOKEN, environment: "sandbox", alerts: { ...ALL_OFF, control: true }, starred: [], homeState: null }, null, NOW);
    const config = { key: pem, keyId: "K6", teamId: "T", topic: "t" };
    // 218 House seats called for Republicans.
    const won = Array.from({ length: 218 }, (_, i) => ({ ...race(1000 + i, "house", "TX", i), candidates: [{ name: `R${i}`, party: "Republican", votes: 10, pct: 100, winner: true, incumbent: false }] }));
    const quiet = Date.parse("2026-11-03T15:00:00Z");
    await dispatchPushes(db, config, won, quiet);
    expect(sent).toHaveLength(0);
    // The flag vanishes before the next run, so the first sighting is forgotten.
    await dispatchPushes(db, config, [], quiet + CONTROL_CONFIRM_MS);
    await dispatchPushes(db, config, won, quiet + 2 * CONTROL_CONFIRM_MS);
    expect(sent).toHaveLength(0);
    await dispatchPushes(db, config, won, quiet + 3 * CONTROL_CONFIRM_MS);
    expect(sent).toHaveLength(1);
    await dispatchPushes(db, config, won, quiet + 4 * CONTROL_CONFIRM_MS);
    expect(sent).toHaveLength(1);
  });
});
