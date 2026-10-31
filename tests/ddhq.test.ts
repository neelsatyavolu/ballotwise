import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountError, signUp } from "../lib/auth/accounts";
import { applyDesk, isDesk, overlayLive } from "../lib/ddhq/apply";
import { finishVotesCode, startVotesCode, votesSessionCookie } from "../lib/ddhq/clerk";
import { deleteDdhqPending, loadDdhqPending, storeDdhqPending } from "../lib/ddhq/pending";
import { deleteDdhqSession, hasDdhqSession, loadDdhqSession, storeDdhqSession, unseal } from "../lib/ddhq/vault";
import { chromeVotes } from "../lib/ddhq/chrome";
import { appEnv } from "../lib/env";
import { clearSeatCache, ddhqRace, pickRace, readCall, readForecast, readResults, votesIsPro } from "../lib/ddhq/votes";
import type { RaceDetail, RaceSummary } from "../lib/midterms/races";
import type { Overview } from "../lib/midterms/view";
import { testDb } from "./sqlite-db";

vi.mock("../lib/env", () => ({ appEnv: vi.fn(() => ({})) }));

const KEY = randomBytes(32).toString("base64");
const CODE = "482913";

afterEach(() => {
  clearSeatCache();
  vi.unstubAllGlobals();
  vi.mocked(appEnv).mockReturnValue({} as ReturnType<typeof appEnv>);
});

function json(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

const hit = (over: Record<string, unknown>) => ({
  source: { race_id: 1, race_date: "2026-11-03", election_type_name: "General Election", office: "US Senate", district: "", ...over },
});

function summary(over: Partial<RaceSummary> = {}): RaceSummary {
  return {
    id: 1,
    office: "senate",
    state: "GA",
    district: null,
    title: "US Senate",
    reporting: 40,
    total: 100,
    candidates: [
      { name: "Jon Ossoff", party: "Democratic", votes: 60, pct: 60, winner: true, incumbent: true },
      { name: "Mike Collins", party: "Republican", votes: 40, pct: 40, winner: false, incumbent: false },
    ],
    rating: null,
    calledFor: "Jon Ossoff",
    call: { id: 9, at: 1, winner: "Jon Ossoff", replaced: null, withdrawn: false },
    ...over,
  };
}

describe("Decision Desk HQ race mapping", () => {
  it("picks the November general and the matching special, including at-large House", () => {
    const rows = [
      hit({ race_id: 9, election_type_name: "Primary Election" }),
      hit({ race_id: 8, race_date: "2024-11-05" }),
      hit({ race_id: 7, office: "Governor" }),
      hit({ race_id: 294677 }),
      hit({ race_id: 294695, election_type_name: "Special Election General" }),
    ];
    expect(pickRace(rows, "senate", null)).toBe("294677");
    expect(pickRace(rows, "senate", null, true)).toBe("294695");
    expect(pickRace(rows, "governor", null)).toBe("7");
    expect(pickRace([hit({ office: "US House", district: "52", race_id: 294782 }), hit({ office: "US House", district: "1", race_id: 1 })], "house", 52)).toBe("294782");
    expect(pickRace([hit({ office: "US House", district: "At-Large", race_id: 295144 })], "house", 0)).toBe("295144");
    expect(pickRace([hit({ office: "US House", district: "", race_id: 100 })], "house", 0)).toBe("100");
    expect(pickRace([hit({ office: "US House", district: "1", race_id: 1 })], "house", 52)).toBeNull();
    expect(pickRace([hit({ race_id: 294677 })], "senate", null, true)).toBeNull();
  });

  it("reads a forecast, a count, and a called winner", () => {
    expect(readForecast({
      parties: [
        { abbrev: "GOP", shortAbbrev: "R", winProbability: 0.11, candidates: [{ firstName: "Mike", lastName: "Collins" }] },
        { abbrev: "DEM", shortAbbrev: "D", winProbability: 0.89, candidates: [{ name: "Jon Ossoff" }] },
        { abbrev: "LIB", winProbability: 0.01, candidates: [{}] },
      ],
    })).toEqual([
      { name: "Jon Ossoff", party: "D", probability: 0.89 },
      { name: "Mike Collins", party: "R", probability: 0.11 },
    ]);
    const body = { raceData: { toplineResults: [
      { winner: false, called_at: null, firstName: "Mike", lastName: "Collins", votes: 40, percent: 40, party: { abbrev: "GOP" } },
      { winner: true, called_at: "2026-11-04T03:00:00Z", firstName: "Jon", lastName: "Ossoff", votes: 60, percent: 60, party: { name: "Democratic" } },
    ], countyResults: [{ fips: "13049", candidates: [{ first_name: "Jon", last_name: "Ossoff", votes: 10, percent: 70, party: { name: "Democratic" } }] }] } };
    expect(readCall(body)).toEqual({ name: "Jon Ossoff", at: "2026-11-04T03:00:00.000Z" });
    expect(readCall({ raceData: { toplineResults: [{ winner: true, called_at: null, firstName: "Jon", lastName: "Ossoff" }] } })).toBeNull();
    expect(readResults(body)).toMatchObject({
      total: 100,
      candidates: [
        { name: "Jon Ossoff", party: "Democratic", votes: 60, pct: 60, winner: true },
        { name: "Mike Collins", party: "Republican", votes: 40, pct: 40, winner: false },
      ],
      counties: [{ fips: "13049", candidates: [{ name: "Jon Ossoff", votes: 10, pct: 70 }] }],
    });
    expect(readForecast({})).toEqual([]);
    expect(readResults({})).toEqual({ candidates: null, counties: [], total: 0 });
  });
});

describe("Votes email code", () => {
  function factors(extra: Record<string, unknown> = {}) {
    return json(200, { response: { id: "sia_1", status: "needs_first_factor", supported_first_factors: [{ strategy: "email_code", email_address_id: "idn_1" }], ...extra } }, ["__client=client-jwt; HttpOnly"]);
  }

  it("keeps the client token for the code step and never the code", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const text = String(init?.body ?? "");
      if (String(url).includes("prepare_first_factor")) {
        expect(text).toContain("email_code");
        expect(text).not.toContain(CODE);
        return json(200, {}, ["__client=client-jwt-2; HttpOnly"]);
      }
      return factors();
    });
    const pending = await startVotesCode("voter@example.com");
    expect(pending).toEqual({ clientToken: "client-jwt-2", signInId: "sia_1", emailAddressId: "idn_1" });
    expect(JSON.stringify(pending)).not.toContain(CODE);

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("attempt_first_factor");
      expect(String(init?.body)).toContain(CODE);
      expect(String((init?.headers as Record<string, string>).cookie)).toContain("__client=client-jwt-2");
      return json(200, { response: { status: "complete", created_session_id: "sess_1" } }, ["__client=client-jwt-3; HttpOnly"]);
    });
    const session = await finishVotesCode(pending, CODE);
    expect(session).toEqual({ clientToken: "client-jwt-3", sessionId: "sess_1" });
    expect(JSON.stringify(session)).not.toContain(CODE);
  });

  it("maps unknown email, a bad code, an account with no email code, and a second factor", async () => {
    vi.stubGlobal("fetch", async () => json(422, { errors: [{ code: "form_identifier_not_found" }] }));
    await expect(startVotesCode("nobody@example.com")).rejects.toMatchObject({ status: 401, message: "Decision Desk HQ has no account for that email." });

    vi.stubGlobal("fetch", async () => json(200, { response: { id: "sia_1", supported_first_factors: [{ strategy: "oauth_google" }] } }, ["__client=client-jwt; HttpOnly"]));
    await expect(startVotesCode("voter@example.com")).rejects.toMatchObject({ status: 400, message: "That Votes account doesn't email a sign-in code. It uses Google, X, The Hill, or only a password." });

    vi.stubGlobal("fetch", async () => json(422, { errors: [{ code: "form_code_incorrect" }] }));
    await expect(finishVotesCode({ clientToken: "c", signInId: "sia_1", emailAddressId: "idn_1" }, CODE)).rejects.toMatchObject({ status: 401, message: "That code doesn't match. Send a new one if it expired." });

    vi.stubGlobal("fetch", async () => json(200, { response: { status: "needs_second_factor" } }));
    await expect(finishVotesCode({ clientToken: "c", signInId: "sia_1", emailAddressId: "idn_1" }, CODE)).rejects.toMatchObject({ status: 400, message: "That Votes account uses a second sign-in step, which Ballotwise can't complete." });

    vi.stubGlobal("fetch", async () => json(503, {}));
    await expect(startVotesCode("voter@example.com")).rejects.toMatchObject({ status: 502 });
  });

  it("mints a session cookie and treats an outage as temporary", async () => {
    vi.stubGlobal("fetch", async () => json(200, { response: { jwt: "session-jwt" } }));
    expect(await votesSessionCookie({ clientToken: "client-jwt", sessionId: "sess_1" })).toBe("__session=session-jwt");
    vi.stubGlobal("fetch", async () => json(401, {}));
    await expect(votesSessionCookie({ clientToken: "client-jwt", sessionId: "sess_1" })).rejects.toMatchObject({ status: 401 });
    vi.stubGlobal("fetch", async () => json(503, {}));
    await expect(votesSessionCookie({ clientToken: "client-jwt", sessionId: "sess_1" })).rejects.toMatchObject({ status: 502 });
    for (const status of [403, 404, 429, 502]) {
      vi.stubGlobal("fetch", async () => json(status, {}));
      await expect(votesSessionCookie({ clientToken: "client-jwt", sessionId: "sess_1" })).rejects.toMatchObject({ status: 502 });
    }
  });
});

function bindEgress(fetcher: (request: Request) => Promise<Response>) {
  const fetch = vi.fn(fetcher);
  vi.mocked(appEnv).mockReturnValue({ DDHQ_EGRESS: { fetch } } as unknown as ReturnType<typeof appEnv>);
  return fetch;
}

describe("Votes Chrome egress", () => {
  it.each([200, 403])("prefers the private egress and preserves %s", async (status) => {
    const native = vi.fn(async () => new Response("checkpoint", { status: 429 }));
    vi.stubGlobal("fetch", native);
    const relay = bindEgress(async () => json(status, status === 403 ? { upgradeRequired: true } : {}));
    expect(await votesIsPro("__session=user-a")).toBe(status === 200);
    const request = relay.mock.calls[0][0];
    expect(request.url).toBe("https://votes.decisiondeskhq.com/api/vote-history?race_id=294677");
    expect(request.headers.get("cookie")).toBe("__session=user-a");
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.cache).toBe("no-store");
    expect(request.redirect).toBe("manual");
    expect(native).not.toHaveBeenCalled();
  });

  it("treats an egress challenge header as temporary, even without a 429", async () => {
    bindEgress(async () => new Response("checkpoint", { status: 403, headers: { "x-vercel-mitigated": "challenge" } }));
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 502 });
  });

  it.each([200, 307, 403])("does not need a direct non-API response (%s) when egress is available", async (status) => {
    vi.stubGlobal("fetch", async () => new Response("not Votes JSON", { status, headers: { "content-type": "text/html" } }));
    bindEgress(async () => json(200, {}));
    expect(await votesIsPro("__session=user-a")).toBe(true);
  });

  it("does not accept malformed JSON as a verified Pro response", async () => {
    vi.stubGlobal("fetch", async () => new Response("not JSON", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 502 });
  });

  it("uses direct fetch with Bearer authentication when there is no egress binding", async () => {
    const direct = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json(200, {}));
    vi.stubGlobal("fetch", direct);
    expect(await votesIsPro("__session=user-a")).toBe(true);
    expect(direct.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "manual" });
    expect(new Headers(direct.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer user-a");
  });

  it.each(["signed-out", "handshake"])("does not misclassify Clerk %s as a free subscription", async (auth) => {
    vi.stubGlobal("fetch", async () => json(429, {}));
    bindEgress(async () => new Response("{}", { status: 403, headers: { "content-type": "application/json", "x-clerk-auth-status": auth } }));
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 502, message: "Decision Desk HQ couldn't verify this Votes session. Request a new code." });
  });

  it("still rejects a signed-in free account", async () => {
    vi.stubGlobal("fetch", async () => json(429, {}));
    bindEgress(async () => new Response("{}", { status: 403, headers: { "content-type": "application/json", "x-clerk-auth-status": "signed-in" } }));
    expect(await votesIsPro("__session=user-a")).toBe(false);
  });

  it.each([false, true])("preserves a real Votes 401 (via egress: %s)", async (viaEgress) => {
    vi.stubGlobal("fetch", async () => json(viaEgress ? 429 : 401, {}));
    if (viaEgress) bindEgress(async () => json(401, {}));
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 401 });
  });

  it.each([429, 502, 503])("keeps egress %s failures temporary", async (status) => {
    vi.stubGlobal("fetch", async () => json(429, {}));
    bindEgress(async () => json(status, {}));
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 502 });
  });

  it("keeps missing bindings, transport failures and non-JSON successes temporary", async () => {
    vi.stubGlobal("fetch", async () => json(429, {}));
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 502 });
    bindEgress(async () => { throw new Error("egress unavailable"); });
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 502 });
    bindEgress(async () => new Response("checkpoint", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 502 });
    bindEgress(async () => new Response(null, { status: 307, headers: { location: "https://clerk.decisiondeskhq.com/" } }));
    await expect(votesIsPro("__session=user-a")).rejects.toMatchObject({ status: 502 });
  });

  it("keeps simultaneous users' cookies on their own requests", async () => {
    const relay = bindEgress(async (request) => {
      await Promise.resolve();
      return json(request.headers.get("cookie") === "__session=user-a" ? 200 : 403, {});
    });
    const responses = await Promise.all([
      chromeVotes("/api/forecast/294677", "__session=user-a"),
      chromeVotes("/api/races/294677", "__session=user-b"),
    ]);
    expect(responses.map((response) => response?.status)).toEqual([200, 403]);
    expect(relay.mock.calls.map(([request]) => [new URL(request.url).pathname, request.headers.get("cookie")])).toEqual([
      ["/api/forecast/294677", "__session=user-a"],
      ["/api/races/294677", "__session=user-b"],
    ]);
  });

  it("rejects unrelated paths and extra cookies before reaching the binding", async () => {
    const relay = bindEgress(async () => json(200, {}));
    for (const path of ["https://example.com/api/races/1", "//example.com/api/races/1", "/api/other", "/api/races/../1", "/api/races/1#fragment"]) {
      expect(await chromeVotes(path, "__session=user-a")).toBeNull();
    }
    expect(await chromeVotes("/api/races/1", "__session=user-a; other=user-b")).toBeNull();
    expect(relay).not.toHaveBeenCalled();
  });

  it("uses the same egress for search, forecast and race calls", async () => {
    vi.stubGlobal("fetch", async (url: string) => String(url).includes("/tokens") ? json(200, { jwt: "session-jwt" }) : json(429, {}));
    const relay = bindEgress(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/searchv2") return json(200, { results: [hit({ race_id: 294677 })] });
      if (path === "/api/forecast/294677") return json(200, { parties: [{ shortAbbrev: "D", winProbability: 0.6, candidates: [{ name: "Jon Ossoff" }] }] });
      return json(200, { raceData: { toplineResults: [] } });
    });
    expect((await ddhqRace({ clientToken: "client-only-for-clerk", sessionId: "s" }, "senate", "GA", null))?.forecast).toHaveLength(1);
    expect(relay.mock.calls.map(([request]) => new URL(request.url).pathname).sort()).toEqual(["/api/forecast/294677", "/api/races/294677", "/api/searchv2"]);
    for (const [request] of relay.mock.calls) expect(request.headers.get("cookie")).toBe("__session=session-jwt");
  });
});

describe("Votes Pro gate", () => {
  it("treats 403 as free and a challenge as a block", async () => {
    vi.stubGlobal("fetch", async () => json(403, { upgradeRequired: true }));
    expect(await votesIsPro("__session=a")).toBe(false);
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 429, headers: { "x-vercel-mitigated": "challenge" } }));
    await expect(votesIsPro("__session=a")).rejects.toBeInstanceOf(AccountError);
  });

  it("loads one user's count, forecast, and call, and does not invent a race", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/tokens")) return json(200, { jwt: "session-jwt" });
      if (u.includes("/api/searchv2")) return json(200, { results: [hit({ race_id: 294677 })] });
      if (u.includes("/api/forecast/")) return json(200, { parties: [{ shortAbbrev: "D", winProbability: 0.6, candidates: [{ name: "Jon Ossoff" }] }] });
      if (u.includes("/api/races/")) {
        return json(200, { raceData: { toplineResults: [{ winner: true, called_at: "2026-11-04T03:00:00Z", firstName: "Jon", lastName: "Ossoff", votes: 10, percent: 100, party: { name: "Democratic" } }] } });
      }
      return json(404, {});
    });
    expect(await ddhqRace({ clientToken: "c", sessionId: "s" }, "senate", "GA", null)).toEqual({
      forecast: [{ name: "Jon Ossoff", party: "D", probability: 0.6 }],
      call: { name: "Jon Ossoff", at: "2026-11-04T03:00:00.000Z" },
      candidates: [{ name: "Jon Ossoff", party: "Democratic", votes: 10, pct: 100, winner: true, incumbent: false }],
      counties: [],
      total: 10,
    });

    clearSeatCache();
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/tokens")) return json(200, { jwt: "session-jwt" });
      if (u.includes("/api/searchv2")) return json(200, { results: [] });
      return json(500, {});
    });
    expect(await ddhqRace({ clientToken: "c", sessionId: "s" }, "house", "WY", 0)).toBeNull();
    expect(seen.some((url) => url.includes("At-Large"))).toBe(true);
  });
});

describe("civicAPI replacement", () => {
  const desk = {
    forecast: [],
    call: { name: "Mike Collins", at: "2026-11-04T03:00:00.000Z" },
    total: 80,
    candidates: [
      { name: "Jon Ossoff", party: "Democratic", votes: 30, pct: 37.5, winner: false, incumbent: true },
      { name: "Mike Collins", party: "Republican", votes: 50, pct: 62.5, winner: true, incumbent: false },
    ],
    counties: [{ fips: "13049", candidates: [{ name: "Jon Ossoff", party: "Democratic", votes: 4, pct: 40 }, { name: "Someone New", party: "Libertarian", votes: 1, pct: 10 }] }],
  };

  it("replaces the count and the call, and clears a civic call Decision Desk HQ has not made", () => {
    const civic = summary();
    const detail: RaceDetail = {
      ...civic,
      pollsClose: null,
      updated: null,
      counties: [{ fips: "13049", name: "Charlton", reporting: 80, total: 9, candidates: [{ name: "Jon Ossoff", party: "Democratic", votes: 9, pct: 100 }], baseline2024: 12, pres2024: null }],
    };
    const next = applyDesk(detail, desk);
    expect(next).not.toBe(detail);
    expect(detail.calledFor).toBe("Jon Ossoff");
    expect(next.calledFor).toBe("Mike Collins");
    expect(next.candidates.find((row) => row.winner)?.name).toBe("Mike Collins");
    expect(next.total).toBe(80);
    expect(next.call).toMatchObject({ winner: "Mike Collins", withdrawn: false });
    expect(next.counties[0]).toMatchObject({ reporting: 0, reportingUnknown: true, baseline2024: 12, total: 5 });
    expect(next.counties[0].candidates.map((row) => row.name)).toEqual(["Jon Ossoff", "Someone New"]);
    expect(isDesk(next)).toBe(true);

    const uncalled = applyDesk(civic, { ...desk, call: null, candidates: desk.candidates.map((row) => ({ ...row, winner: false })) });
    expect(uncalled.calledFor).toBeNull();
    expect(uncalled.call).toBeNull();
    expect(uncalled.candidates.every((row) => !row.winner)).toBe(true);

    const kept = applyDesk(civic, { ...desk, candidates: null });
    expect(kept).toBe(civic);
    expect(isDesk(kept)).toBe(false);
  });

  it("rebuilds the overview call list for this user only", () => {
    const civic = summary();
    const overview = { races: [civic, summary({ id: 2, office: "measure", title: "Question 1" })], balance: { senate: { D: 0, R: 0, other: 0, total: 100, majority: 51, uncalled: 0 }, house: { D: 0, R: 0, other: 0, total: 435, majority: 218, uncalled: 0 }, governor: { D: 0, R: 0, other: 0, total: 50, majority: 26, uncalled: 0 } }, fetchedAt: 1, stale: false, ratings: { updatedAt: null }, callEvents: [], callEventCounts: { senate: 4, house: 0, governor: 0, measure: 0 } } as Overview;
    const next = overlayLive("/api/midterms", overview, new Map([["senate:GA::g", desk]]));
    expect(next.races[0].calledFor).toBe("Mike Collins");
    expect(next.races[1]).toBe(overview.races[1]);
    expect(overview.races[0].calledFor).toBe("Jon Ossoff");
    expect(next.callEvents?.[0]).toMatchObject({ winner: "Mike Collins", kind: "call" });
    expect(next.callEventCounts).toBeUndefined();
    expect(overlayLive("/api/midterms", overview, new Map())).toBe(overview);
  });
});

describe("Votes session vault", () => {
  it("stores the session encrypted for that user only, and a pending code expires without connecting", async () => {
    const db = testDb();
    const { user } = await signUp(db, "a@example.com", "a long password", 1);
    const session = { clientToken: "client-token-value", sessionId: "sess_9" };
    await storeDdhqSession(db, KEY, user.id, "voter@example.com", session, 5);
    const row = await db.prepare("SELECT sealed, email FROM ddhq_connections WHERE user_id = ?").bind(user.id).first<{ sealed: string; email: string }>();
    expect(row?.email).toBe("voter@example.com");
    expect(row?.sealed).not.toContain("client-token-value");
    expect(row?.sealed).not.toContain(CODE);
    expect(await loadDdhqSession(db, KEY, user.id)).toEqual({ email: "voter@example.com", session });
    expect(await unseal(row!.sealed, KEY, "someone-else")).toBeNull();
    expect(await loadDdhqSession(db, randomBytes(32).toString("base64"), user.id)).toBeNull();
    expect(await hasDdhqSession(db, user.id)).toBe(true);
    await deleteDdhqSession(db, user.id);

    const pending = { clientToken: "pending-client", signInId: "sia_9", emailAddressId: "idn_9" };
    await storeDdhqPending(db, KEY, user.id, "voter@example.com", pending, 1_000);
    expect(await hasDdhqSession(db, user.id)).toBe(false);
    const saved = await loadDdhqPending(db, KEY, user.id, 1_000 + 10 * 60 * 1000 - 1);
    expect(saved?.pending).toEqual(pending);
    const sealed = await db.prepare("SELECT sealed FROM ddhq_pending WHERE user_id = ?").bind(user.id).first<{ sealed: string }>();
    expect(sealed?.sealed).not.toContain("pending-client");
    expect(sealed?.sealed).not.toContain(CODE);
    expect(await loadDdhqPending(db, KEY, user.id, 1_000 + 10 * 60 * 1000)).toBeNull();

    await deleteDdhqSession(db, user.id);
    await deleteDdhqPending(db, user.id);
    expect(await hasDdhqSession(db, user.id)).toBe(false);
    expect(await loadDdhqSession(db, KEY, user.id)).toBeNull();
  });
});
