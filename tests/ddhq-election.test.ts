import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountError } from "../lib/auth/accounts";
import { applyDesk, deskKeyFor, isDesk, overlayLive } from "../lib/ddhq/apply";
import { clearSeatCache, ddhqRace, ddhqSeats, readCall, readResults, rememberRaceIds, type DdhqRace, type DdhqSeat } from "../lib/ddhq/votes";
import { appEnv } from "../lib/env";
import { balance, HOLDOVER, type RaceDetail, type RaceSummary } from "../lib/midterms/races";
import { callKey } from "../lib/midterms/moments";
import { lead, type Overview } from "../lib/midterms/view";

vi.mock("../lib/env", () => ({ appEnv: vi.fn(() => ({})) }));

afterEach(() => {
  clearSeatCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(appEnv).mockReturnValue({} as ReturnType<typeof appEnv>);
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Synthetic observations using the field names, percentage units and timestamp format verified on
// completed 2024 Votes races. No downloaded Votes response is stored in this fixture.
function topline(votes: [number, number, number], winner: number | null = null, calledAt: string | null = null) {
  const totalVotes = votes.reduce((sum, count) => sum + count, 0);
  return {
    id: 101, totalVotes, lastUpdated: "2026-11-04 03:00:00.123456+00",
    turnout: { precincts_in: totalVotes ? 4 : 0, precincts_tot: 10 },
    toplineResults: votes.map((count, i) => ({
      candId: i + 1, firstName: ["Avery", "Blake", "Casey"][i], lastName: "Candidate",
      votes: count, percent: totalVotes ? count / totalVotes * 100 : 0,
      winner: winner === i, called_at: winner === i ? calledAt : null,
      party: { name: ["Democratic", "Republican", "Independent"][i] }, incumbent: false,
    })),
  };
}

function rawRace(): RaceSummary {
  return {
    id: 1, office: "senate", state: "GA", district: null, title: "US Senate",
    reporting: 99, total: 9999, rating: null,
    candidates: [{ name: "Blake Candidate", party: "Republican", votes: 9999, pct: 100, winner: true, incumbent: false }],
    calledFor: "Blake Candidate", call: { id: 9, at: 1, winner: "Blake Candidate", replaced: null, withdrawn: false },
    callPending: true, callUnknown: true, missing: true, lastSeen: 1, round: 3,
    trend: { since: 1, baselineAt: 1, votesAdded: 9999, prevMargin: 0, prevLeader: null, lastChange: 1 },
  };
}

function parsed(row: ReturnType<typeof topline>): DdhqRace {
  const body = { raceData: row };
  return { forecast: [], call: readCall(body), ...readResults(body) };
}

describe("observed Votes result schema", () => {
  it("keeps low-share percentage points and explicit zero percentages", () => {
    const row = topline([500, 497, 3]);
    const result = readResults({ raceData: row });
    expect(result.candidates?.find((candidate) => candidate.name === "Casey Candidate")?.pct).toBe(0.3);
    row.toplineResults[2].percent = 0;
    expect(readResults({ raceData: row }).candidates?.find((candidate) => candidate.name === "Casey Candidate")?.pct).toBe(0);
  });

  it("uses published totals including unattributed votes, and computes only missing percentages", () => {
    const row = { ...topline([500, 497, 3]), totalVotes: 1100 };
    const body = { raceData: { ...row, toplineResults: row.toplineResults.map((candidate) => ({ ...candidate, percent: undefined })) } };
    const result = readResults(body);
    expect(result.total).toBe(1100);
    expect(result.candidates?.[0].pct).toBeCloseTo(500 / 1100 * 100);
    const withoutTotal = { ...row, totalVotes: undefined };
    expect(readResults({ raceData: withoutTotal }).total).toBe(1000);
    expect(readResults({ raceData: { ...topline([0, 0, 0]), totalVotes: 0 } }).total).toBe(0);
  });

  it("reads actual precinct reporting, county totals and PostgreSQL timestamps", () => {
    const body = { raceData: {
      ...topline([500, 497, 3], 0, "2026-11-04 03:00:00.123456Z"),
      countyResults: [{ county: "Example County", fips: "13049",
        liveTurnoutEstimate: { totalVotes: 1000, precinctsIn: 2, precinctsTot: 4 },
        candidates: [{ first_name: "Avery", last_name: "Candidate", votes: 497, percent: 49.7, party: { name: "Democratic" } }, { first_name: "Casey", last_name: "Candidate", votes: 3, percent: 0.3, party: { name: "Independent" } }],
      }],
    } };
    const result = readResults(body);
    expect(result).toMatchObject({ reporting: 40, resultsUpdatedAt: "2026-11-04T03:00:00.123Z" });
    expect(result.counties[0]).toMatchObject({ name: "Example County", fips: "13049", total: 1000, reporting: 50 });
    expect(result.counties[0].candidates[1].pct).toBe(0.3);
    expect(readCall(body)).toEqual({ name: "Avery Candidate", at: "2026-11-04T03:00:00.123Z" });
  });

  it("does not invent call times or keep stale civic reporting and county data", () => {
    const detail: RaceDetail = { ...rawRace(), updated: "2026-11-03T00:00:00Z", pollsClose: null,
      counties: [{ fips: "13049", name: "Example County", total: 9999, reporting: 99, candidates: [{ name: "Blake Candidate", party: "Republican", votes: 9999, pct: 100 }], baseline2024: 4, pres2024: null }],
    };
    const row = topline([500, 497, 3], 0, null);
    const source = parsed(row);
    const next = applyDesk(detail, source);
    expect(readCall({ raceData: row })).toBeNull();
    expect(next.calledFor).toBe("Avery Candidate");
    expect(next.call).toBeNull();
    expect(next.reporting).toBe(40);
    expect(next.updated).toBe("2026-11-04T03:00:00.123Z");
    expect(next.counties[0]).toMatchObject({ total: 0, reporting: 0, reportingUnknown: true, candidates: [], baseline2024: 4 });
    expect(next.trend).toBeUndefined();
    expect(next.missing).toBeUndefined();
    expect(next.callUnknown).toBeUndefined();
    expect(next.round).toBeUndefined();
    expect(detail.counties[0].total).toBe(9999);
    expect(readCall({ raceData: topline([500, 497, 3], 0, "not a timestamp") })).toBeNull();
    row.toplineResults[0].winner = false;
    row.toplineResults[0].called_at = "2026-11-04 03:00:00.123456Z";
    expect(readCall({ raceData: row })).toBeNull();
    const unknown = applyDesk(rawRace(), { ...source, reporting: undefined });
    expect(unknown.reporting).toBe(0);
    expect(unknown.reportingUnknown).toBe(true);
  });

  it("replaces county candidate rows and adds provider counties omitted by the civic catalog", () => {
    const detail: RaceDetail = { ...rawRace(), updated: null, pollsClose: null, counties: [{ fips: "13049", name: "Example County", total: 9999, reporting: 99, candidates: [{ name: "Removed Candidate", party: "Other", votes: 9999, pct: 100 }], baseline2024: 4, pres2024: null }] };
    const source = { ...parsed(topline([5, 3, 0])), counties: [
      { fips: "13049", name: "Example County", total: 10, reporting: 20, candidates: [{ name: "Avery Candidate", party: "Democratic", votes: 5, pct: 50 }] },
      { fips: "13051", name: "Another County", total: 3, reporting: 10, candidates: [{ name: "Blake Candidate", party: "Republican", votes: 3, pct: 100 }] },
    ] };
    const next = applyDesk(detail, source);
    expect(next.counties).toHaveLength(2);
    expect(next.counties[0]).toMatchObject({ total: 10, reporting: 20, baseline2024: 4 });
    expect(next.counties[0].candidates.map((candidate) => candidate.name)).toEqual(["Avery Candidate"]);
    expect(next.counties[1]).toMatchObject({ name: "Another County", total: 3, baseline2024: null });
  });
});

describe("DDHQ election-night snapshot updates", () => {
  it("keys corrected DDHQ calls by their true current state and removes withdrawn calls", () => {
    const race = rawRace();
    const raw: Overview = { races: [race], balance: balance([race]), fetchedAt: 1, stale: false, ratings: { updatedAt: null }, callEvents: [] };
    const initial = overlayLive("/api/midterms", raw, new Map([[deskKeyFor(race), parsed(topline([100, 120, 0], 1, "2026-11-04 03:10:00.123456Z"))]]));
    const corrected = overlayLive("/api/midterms", raw, new Map([[deskKeyFor(race), parsed(topline([140, 120, 0], 0, "2026-11-04 03:11:00.123456Z"))]]));
    const withdrawn = overlayLive("/api/midterms", raw, new Map([[deskKeyFor(race), parsed(topline([140, 120, 0]))]]));
    const first = initial.callEvents![0];
    const next = corrected.callEvents![0];
    expect(first.source).toBe("ddhq");
    expect(next.source).toBe("ddhq");
    expect(first.at).toBe(Date.parse("2026-11-04T03:10:00.123Z"));
    expect(callKey(next)).not.toBe(callKey(first));
    expect(corrected.callEvents?.map(callKey)).not.toContain(callKey(first));
    expect(withdrawn.callEvents).toEqual([]);
    expect(withdrawn.callEvents?.map(callKey)).not.toContain(callKey(next));
  });

  it("keeps same-time DDHQ calls distinct and preserves public event key semantics", () => {
    const race = rawRace();
    const other = { ...rawRace(), id: 2, state: "NC" };
    const measure = { ...rawRace(), id: 3, office: "measure" as const, call: { id: 91, at: 4, winner: "Blake Candidate", replaced: null, withdrawn: false as const } };
    const raw: Overview = { races: [race, other, measure], balance: balance([race, other, measure]), fetchedAt: 1, stale: false, ratings: { updatedAt: null } };
    const source = parsed(topline([140, 120, 0], 0, "2026-11-04 03:11:00.123456Z"));
    const next = overlayLive("/api/midterms", raw, new Map([[deskKeyFor(race), source], [deskKeyFor(other), source]]));
    const privateEvents = next.callEvents!.filter((event) => event.source === "ddhq");
    expect(privateEvents).toHaveLength(2);
    expect(privateEvents[0].at).toBe(privateEvents[1].at);
    expect(new Set(privateEvents.map(callKey)).size).toBe(2);
    const publicEvent = next.callEvents!.find((event) => event.raceId === 3)!;
    expect(publicEvent.source).toBeUndefined();
    expect(publicEvent.id).toBe(91);
    expect(callKey(publicEvent)).toBe("call:91");
    expect(callKey({ id: 123 })).toBe("call:123");
    expect(callKey({ ...privateEvents[0], winner: "Different Candidate" })).not.toBe(callKey(privateEvents[0]));
  });

  it("handles no votes, lead changes, calls, corrected calls, withdrawals and zero resets without public-state mutation", () => {
    const race = rawRace();
    const raw: Overview = { races: [race], balance: balance([race]), fetchedAt: 1, stale: false, ratings: { updatedAt: null }, callEvents: [] };
    const before = structuredClone(raw);
    const snapshots = [
      { row: topline([0, 0, 0]), leader: null, winner: null },
      { row: topline([60, 40, 0]), leader: "Avery Candidate", winner: null },
      { row: topline([70, 90, 0]), leader: "Blake Candidate", winner: null },
      { row: topline([70, 100, 0], 1, "2026-11-04 03:10:00.123456Z"), leader: "Blake Candidate", winner: "Blake Candidate" },
      { row: topline([120, 100, 0], 0, "2026-11-04 03:11:00.123456Z"), leader: "Avery Candidate", winner: "Avery Candidate" },
      { row: topline([120, 100, 0]), leader: "Avery Candidate", winner: null },
      { row: topline([0, 0, 0]), leader: null, winner: null },
    ];
    for (const snapshot of snapshots) {
      const source = parsed(snapshot.row);
      const next = overlayLive("/api/midterms", raw, new Map([[deskKeyFor(race), source]]));
      expect(lead(next.races[0].candidates)?.leader.name ?? null).toBe(snapshot.leader);
      expect(next.races[0].calledFor).toBe(snapshot.winner);
      expect(next.callEvents?.map((event) => event.winner)).toEqual(snapshot.winner ? [snapshot.winner] : []);
      expect(next.balance.senate.D).toBe(HOLDOVER.senate.D + (snapshot.winner === "Avery Candidate" ? 1 : 0));
      expect(next.balance.senate.R).toBe(HOLDOVER.senate.R + (snapshot.winner === "Blake Candidate" ? 1 : 0));
      expect(next.races[0].total).toBe(snapshot.row.totalVotes);
      expect(isDesk(next.races[0])).toBe(true);
      expect(raw).toEqual(before);
    }
    expect(overlayLive("/api/midterms", raw, new Map())).toBe(raw);
  });
});

describe("authenticated DDHQ requests", () => {
  const session = { clientToken: "client-only-for-clerk", sessionId: "session" };
  const seats: DdhqSeat[] = [
    { office: "senate", state: "GA", district: null, special: false },
    { office: "house", state: "CA", district: 16, special: false },
  ];
  function bind(fetcher: (request: Request) => Promise<Response>) {
    const fetch = vi.fn(fetcher);
    vi.mocked(appEnv).mockReturnValue({ DDHQ_EGRESS: { fetch } } as unknown as ReturnType<typeof appEnv>);
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { jwt: "same-user-jwt" })));
    return fetch;
  }

  function houseSeats(count: number): DdhqSeat[] {
    return Array.from({ length: count }, (_, index) => ({
      office: "house", state: index < 52 ? "CA" : index < 90 ? "TX" : "NY",
      district: index < 52 ? index + 1 : index < 90 ? index - 51 : index - 89, special: false,
    }));
  }

  function warm(seats: DdhqSeat[]) {
    rememberRaceIds(seats.map((seat, index) => ({ key: deskKeyFor({ ...seat, title: "General" }), id: String(index + 101) })));
  }

  function pageFor(seats: DdhqSeat[]): string {
    const parties = [
      { partyId: 1, shortAbbrev: "D", winProbability: 0.6, seats: 239, candidates: [{ name: "Avery Candidate" }] },
      { partyId: 2, shortAbbrev: "R", winProbability: 0.4, seats: 196, candidates: [{ name: "Blake Candidate" }] },
    ];
    return "1:" + JSON.stringify({
      forecasts: seats.map((_, index) => ({ raceId: index + 101, parties, rating: "Lean", updatedAt: "2026-10-30T12:00:00Z" })),
      racesViz: seats.map((seat, index) => ({ id: index + 101, stateAbb: seat.state, office: "US House", officeId: 1, district: String(seat.district), electionType: "General Election", race_date: "2026-11-03" })),
      overviews: [{ toplineId: 1, officeId: 1, forecast: { officeId: 1, stateId: null, year: 2026, parties, updatedAt: "2026-10-30T12:00:00Z" }, timeseries: [], simulations: [] }],
    });
  }

  function rowsFor(request: Request, total = 1): Response {
    return json(200, new URL(request.url).searchParams.get("ids")!.split(",").map((id) => ({ ...topline([total, 0, 0]), id: Number(id) })));
  }

  it("fetches one lightweight topline batch after warmed metadata, in requested order, without forecast calls", async () => {
    rememberRaceIds(seats.map((seat, i) => ({ key: deskKeyFor({ ...seat, title: "General" }), id: String(i + 101) })));
    const relay = bind(async () => json(200, [{ ...topline([4, 6, 0]), id: 102 }, topline([60, 40, 0])]));
    const result = await ddhqSeats(session, seats);
    expect(relay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(relay.mock.calls[0][0].url).toBe("https://votes.decisiondeskhq.com/api/races/batch/topline?ids=101,102");
    expect(relay.mock.calls[0][0].headers.get("cookie")).toBe("__session=same-user-jwt");
    expect(result.map((row) => row.race?.total)).toEqual([100, 10]);
    expect(result.every((row) => row.race?.forecast.length === 0)).toBe(true);
    expect(result.every((row) => row.race?.counties.length === 0)).toBe(true);
  });

  it("resolves uncached IDs at concurrency four then batches the found seats", async () => {
    const many = ["GA", "CA", "ME", "MI", "TX", "NC"].map((state) => ({ office: "senate" as const, state, district: null, special: false }));
    let pending = 0;
    let peak = 0;
    let index = 100;
    const relay = bind(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/searchv2") {
        pending++;
        peak = Math.max(peak, pending);
        await new Promise((resolve) => setTimeout(resolve, 2));
        pending--;
        return json(200, { results: [{ source: { race_id: ++index, race_date: "2026-11-03", election_type_name: "General Election", office: "US Senate", district: "" } }] });
      }
      return json(200, (url.searchParams.get("ids") ?? "").split(",").map((id) => ({ ...topline([1, 0, 0]), id: Number(id) })));
    });
    expect(await ddhqSeats(session, many)).toHaveLength(6);
    expect(peak).toBe(4);
    expect(relay.mock.calls.filter(([request]) => new URL(request.url).pathname === "/api/races/batch/topline")).toHaveLength(1);
    expect(relay).toHaveBeenCalledTimes(7);
  });

  it("returns null for omitted rows and does not retain results from a prior batch", async () => {
    rememberRaceIds([{ key: "senate:GA::g", id: "101" }, { key: "house:CA:16:g", id: "102" }]);
    const relay = bind(async () => json(200, [topline([1, 0, 0])]));
    expect((await ddhqSeats(session, seats)).map((row) => row.race?.total ?? null)).toEqual([1, null]);
    relay.mockImplementation(async () => json(200, []));
    expect((await ddhqSeats(session, seats)).map((row) => row.race)).toEqual([null, null]);
  });

  it.each([401, 429, 502])("preserves auth expiration but keeps batch status %s temporary otherwise", async (status) => {
    rememberRaceIds([{ key: "senate:GA::g", id: "101" }]);
    bind(async () => json(status, {}));
    await expect(ddhqSeats(session, seats.slice(0, 1))).rejects.toMatchObject({ status: status === 401 ? 401 : 502 });
  });

  it("does not mistake a malformed batch wrapper for an empty successful result", async () => {
    rememberRaceIds([{ key: "senate:GA::g", id: "101" }]);
    bind(async () => json(200, { rows: [] }));
    await expect(ddhqSeats(session, seats.slice(0, 1))).rejects.toBeInstanceOf(AccountError);
  });

  it("splits a full board into groups of 24 at concurrency four with one token mint", async () => {
    const full = houseSeats(97);
    warm(full);
    let pending = 0;
    let peak = 0;
    const relay = bind(async (request) => {
      pending++;
      peak = Math.max(peak, pending);
      await new Promise((resolve) => setTimeout(resolve, 2));
      pending--;
      return rowsFor(request);
    });
    const result = await ddhqSeats(session, full);
    expect(result).toHaveLength(97);
    expect(result.every((row) => row.race?.total === 1)).toBe(true);
    expect(peak).toBe(4);
    expect(relay.mock.calls.map(([request]) => new URL(request.url).searchParams.get("ids")!.split(",").length)).toEqual([24, 24, 24, 24, 1]);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    for (const [request] of relay.mock.calls) expect(request.headers.get("cookie")).toBe("__session=same-user-jwt");
  });

  it.each([429, 502])("keeps successful full-board groups when another group returns %s", async (status) => {
    const full = houseSeats(49);
    warm(full);
    bind(async (request) => new URL(request.url).searchParams.get("ids")!.startsWith("125,") ? json(status, {}) : rowsFor(request));
    const result = await ddhqSeats(session, full);
    expect(result.slice(0, 24).every((row) => row.race?.total === 1)).toBe(true);
    expect(result.slice(24, 48).every((row) => row.race === null)).toBe(true);
    expect(result[48].race?.total).toBe(1);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it("propagates a real upstream 401 from any full-board group", async () => {
    const full = houseSeats(49);
    warm(full);
    bind(async (request) => new URL(request.url).searchParams.get("ids")!.startsWith("125,") ? json(401, {}) : rowsFor(request));
    await expect(ddhqSeats(session, full)).rejects.toMatchObject({ status: 401 });
  });

  it("primes a cold full board from the needed forecast page without per-seat searches or retaining its forecasts", async () => {
    const full = houseSeats(25);
    let currentTotal = 1;
    const relay = bind(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/forecast/2026/house") return new Response(pageFor(full), { headers: { "content-type": "text/x-component" } });
      expect(path).toBe("/api/races/batch/topline");
      return rowsFor(request, currentTotal);
    });
    const result = await ddhqSeats(session, full);
    expect(result.every((row) => row.race?.total === 1 && row.race.forecast.length === 0)).toBe(true);
    expect(relay.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual(["/forecast/2026/house", "/api/races/batch/topline", "/api/races/batch/topline"]);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    for (const [request] of relay.mock.calls) expect(request.headers.get("cookie")).toBe("__session=same-user-jwt");
    currentTotal = 2;
    const refreshed = await ddhqSeats(session, full);
    expect(refreshed.every((row) => row.race?.total === 2)).toBe(true);
    expect(relay.mock.calls.filter(([request]) => new URL(request.url).pathname.startsWith("/forecast/"))).toHaveLength(1);
  });

  it.each(["unavailable", "refused page", "changed payload"])("still gets counts through bounded search when the metadata primer has %s", async (failure) => {
    const full = houseSeats(25);
    let pending = 0;
    let peak = 0;
    const relay = bind(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/forecast/")) return failure === "changed payload" ? new Response("changed Flight payload", { headers: { "content-type": "text/x-component" } }) : json(failure === "refused page" ? 403 : 502, {});
      if (url.pathname === "/api/searchv2") {
        pending++;
        peak = Math.max(peak, pending);
        await new Promise((resolve) => setTimeout(resolve, 2));
        pending--;
        const district = Number(url.searchParams.get("q")!.split(" ").at(-1));
        return json(200, { results: [{ source: { race_id: 100 + district, office: "US House", district: String(district), race_date: "2026-11-03", election_type_name: "General Election" } }] });
      }
      return rowsFor(request);
    });
    expect((await ddhqSeats(session, full)).every((row) => row.race?.total === 1)).toBe(true);
    expect(peak).toBe(4);
    expect(relay.mock.calls.filter(([request]) => new URL(request.url).pathname === "/api/searchv2")).toHaveLength(25);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a metadata-primer 401 as a forecast outage", async () => {
    const relay = bind(async () => json(401, {}));
    await expect(ddhqSeats(session, houseSeats(25))).rejects.toMatchObject({ status: 401 });
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled full-board primer by the 25-second pass deadline", async () => {
    const deadline = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const timer = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === 25_000 ? deadline.signal : timeout(ms));
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const relay = bind(async (request) => {
      started();
      await new Promise<void>((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("request stopped")), { once: true }));
      return json(200, []);
    });
    const result = expect(ddhqSeats(session, houseSeats(25))).rejects.toMatchObject({ status: 502 });
    await ready;
    deadline.abort();
    await result;
    expect(timer).toHaveBeenCalledWith(25_000);
    expect(relay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it("propagates caller cancellation and does not start queued full-board groups", async () => {
    const full = houseSeats(97);
    warm(full);
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const relay = bind(async (request) => {
      started();
      await new Promise<void>((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("request stopped")), { once: true }));
      return json(200, []);
    });
    const result = expect(ddhqSeats(session, full, controller.signal)).rejects.toMatchObject({ status: 502 });
    await ready;
    controller.abort();
    await result;
    expect(relay.mock.calls.length).toBeLessThanOrEqual(4);
    for (const [request] of relay.mock.calls) expect(request.signal.aborted).toBe(true);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it("retries an empty race search instead of caching the miss for six hours", async () => {
    let searches = 0;
    const relay = bind(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/searchv2") {
        searches++;
        return json(200, { results: searches === 1 ? [] : [{ source: { race_id: 101, office: "US Senate", district: "", race_date: "2026-11-03", election_type_name: "General Election" } }] });
      }
      return path === "/api/races/101" ? json(200, { raceData: topline([60, 40, 0]) }) : json(200, { parties: [] });
    });
    expect(await ddhqRace(session, "senate", "GA", null)).toBeNull();
    expect((await ddhqRace(session, "senate", "GA", null))?.total).toBe(100);
    expect(searches).toBe(2);
    expect(relay).toHaveBeenCalledTimes(4);
  });

  it("invalidates an ID when both race endpoints return 404 and resolves the replacement next time", async () => {
    rememberRaceIds([{ key: "senate:GA::g", id: "101" }]);
    const relay = bind(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/101")) return json(404, {});
      if (path === "/api/searchv2") return json(200, { results: [{ source: { race_id: 202, office: "US Senate", district: "", race_date: "2026-11-03", election_type_name: "General Election" } }] });
      return path === "/api/races/202" ? json(200, { raceData: { ...topline([30, 20, 0]), id: 202 } }) : json(200, { parties: [] });
    });
    expect(await ddhqRace(session, "senate", "GA", null)).toBeNull();
    expect((await ddhqRace(session, "senate", "GA", null))?.total).toBe(50);
    expect(relay.mock.calls.filter(([request]) => new URL(request.url).pathname === "/api/searchv2")).toHaveLength(1);
    expect(relay.mock.calls.filter(([request]) => new URL(request.url).pathname.endsWith("/101"))).toHaveLength(2);
  });

  it.each(["caller", "deadline"])("stops a single-race search on %s cancellation without launching detail fetches", async (kind) => {
    const controller = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    if (kind === "deadline") vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === 25_000 ? controller.signal : timeout(ms));
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const relay = bind(async (request) => {
      started();
      await new Promise<void>((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("request stopped")), { once: true }));
      return json(200, {});
    });
    const result = expect(ddhqRace(session, "senate", "GA", null, false, kind === "caller" ? controller.signal : undefined)).rejects.toMatchObject({ status: 502 });
    await ready;
    controller.abort();
    await result;
    expect(relay).toHaveBeenCalledTimes(1);
    expect(new URL(relay.mock.calls[0][0].url).pathname).toBe("/api/searchv2");
    expect(relay.mock.calls[0][0].signal.aborted).toBe(true);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it("cancels both in-flight detail requests with the single-race caller signal", async () => {
    rememberRaceIds([{ key: "senate:GA::g", id: "101" }]);
    const controller = new AbortController();
    let requests = 0;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const relay = bind(async (request) => {
      if (++requests === 2) started();
      await new Promise<void>((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("request stopped")), { once: true }));
      return json(200, {});
    });
    const result = expect(ddhqRace(session, "senate", "GA", null, false, controller.signal)).rejects.toMatchObject({ status: 502 });
    await ready;
    controller.abort();
    await result;
    expect(relay).toHaveBeenCalledTimes(2);
    for (const [request] of relay.mock.calls) expect(request.signal.aborted).toBe(true);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });
});
