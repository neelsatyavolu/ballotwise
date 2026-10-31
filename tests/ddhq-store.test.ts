import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeskStore, deskOwner, deskSeatKey, EMPTY_DESK } from "../lib/ddhq/store";
import type { DdhqForecastBundle } from "../lib/ddhq/forecast-types";
import type { DdhqRace, DdhqSeat } from "../lib/ddhq/votes";

const GA: DdhqSeat = { state: "GA", office: "senate", district: null, special: false };
const MI: DdhqSeat = { state: "MI", office: "senate", district: null, special: false };
const keyOf = (seat: DdhqSeat) => `${seat.office}:${seat.state}:${seat.office === "house" ? (seat.district ?? 0) : ""}:${seat.special ? "s" : "g"}`;
const race = (over: Partial<DdhqRace> = {}): DdhqRace => ({
  forecast: [{ name: "Candidate", party: "D", probability: 0.7 }], rating: "lean-d", updatedAt: 1,
  call: null, candidates: null, counties: [], total: 0, ...over,
});
const count = race({ candidates: [{ name: "Candidate", party: "D", votes: 100, pct: 100, winner: false, incumbent: false }], total: 100 });
const bundle = (rows = [{ key: keyOf(GA), race: race() }]): DdhqForecastBundle => ({
  races: rows, overview: { source: "ddhq", updatedAt: 1, chambers: {}, history: null },
});
type Call = { path: string; body: unknown; signal: AbortSignal; resolve: (value: unknown) => void; reject: (error: unknown) => void };

function setup() {
  const calls: Call[] = [];
  const store = createDeskStore(<T,>(path: string, body: unknown, signal: AbortSignal) => new Promise<T>((resolve, reject) => {
    calls.push({ path, body, signal, resolve: (value) => resolve(value as T), reject });
  }));
  return { store, calls };
}

async function settled() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.parse("2026-10-31T12:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("private DDHQ store", () => {
  it("uses the server owner only until a known client account state wins", () => {
    expect(deskOwner("A", { loading: true, user: null, ddhq: "disconnected" })).toBe("A");
    expect(deskOwner(null, { loading: true, user: null, ddhq: "disconnected" })).toBeNull();
    expect(deskOwner("A", { loading: false, user: null, ddhq: "disconnected" })).toBeNull();
    expect(deskOwner("A", { loading: false, user: { id: "A" }, ddhq: "disconnected" })).toBeNull();
    expect(deskOwner("A", { loading: true, user: { id: "B" }, ddhq: "connected" })).toBe("B");
    expect(deskOwner("A", { loading: true, user: { id: "A" }, ddhq: "disconnected" })).toBeNull();
    expect(deskSeatKey(GA)).toBe(keyOf(GA));
  });

  it("loads results while the forecast is blocked, including genuine zero counts", async () => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    const pending = store.getSnapshot();
    expect(calls.map((call) => call.path)).toEqual(["/api/ddhq/forecast", "/api/ddhq/races"]);
    expect(pending.countsReady.size).toBe(0);
    expect(pending.countsFailed.size).toBe(0);
    calls[1].resolve({ races: [{ key: keyOf(GA), race: race({ candidates: [], total: 0 }) }] }); await settled();
    expect(store.getSnapshot().forecastStatus).toBe("loading");
    expect(store.getSnapshot().countsReady.has(keyOf(GA))).toBe(true);
    expect(store.getSnapshot().countsFailed.size).toBe(0);
    expect(store.getSnapshot().countsFetchedAt).toBe(Date.now());
    expect(store.getSnapshot().races.get(keyOf(GA))?.candidates).toEqual([]);
    expect(pending.countsReady.size).toBe(0);
  });

  it("marks unavailable rows and request failures as real fallback, then recovers", async () => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    calls[1].resolve({ races: [{ key: keyOf(GA), race: null }] }); await settled();
    expect(store.getSnapshot().countsFailed.has(keyOf(GA))).toBe(true);
    expect(store.getSnapshot().countsReady.size).toBe(0);
    expect(store.getSnapshot().countsError).not.toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    calls[2].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    const ready = store.getSnapshot();
    expect(ready.countsReady.has(keyOf(GA))).toBe(true);
    expect(ready.countsFailed.size).toBe(0);
    expect(ready.countsError).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    calls[3].reject(Object.assign(new Error("Votes temporarily unavailable"), { status: 502 })); await settled();
    expect(store.getSnapshot().countsReady.size).toBe(0);
    expect(store.getSnapshot().countsFailed.has(keyOf(GA))).toBe(true);
    expect(store.getSnapshot().countsError).toBe("Votes temporarily unavailable");
    expect(store.getSnapshot().races.has(keyOf(GA))).toBe(false);
    expect(ready.countsReady.has(keyOf(GA))).toBe(true);
  });

  it("retains owner-scoped counts across tracker navigation while a keeper remains", async () => {
    const { store, calls } = setup();
    const keeper = store.subscribe(() => {}); const page = store.subscribe(() => {});
    const first = Symbol();
    store.setSeats(first, [GA]); store.connect("A", async () => {});
    calls[0].resolve(bundle()); calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    store.removeSeats(first); page();
    expect(store.getSnapshot().races.get(keyOf(GA))?.total).toBe(100);
    const nextPage = store.subscribe(() => {});
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    expect(store.getSnapshot().countsReady.has(keyOf(GA))).toBe(true);
    expect(store.getSnapshot().races.get(keyOf(GA))?.total).toBe(100);
    expect(calls.filter((call) => call.path === "/api/ddhq/forecast")).toHaveLength(1);
    expect(calls.filter((call) => call.path === "/api/ddhq/races")).toHaveLength(2);
    expect(calls[2].signal.aborted).toBe(false);
    nextPage(); keeper();
    expect(store.getSnapshot()).toBe(EMPTY_DESK);
    expect(calls[2].signal.aborted).toBe(true);
  });

  it.each([
    ["2026-10-31T12:00:00Z", 30_000],
    ["2026-11-03T12:00:00Z", 15_000],
  ] as const)("keeps warm navigation instant but waits for fresh counts after the %s polling interval", async (now, ttl) => {
    vi.setSystemTime(Date.parse(now));
    const { store, calls } = setup();
    const keeper = store.subscribe(() => {}); const first = Symbol();
    store.setSeats(first, [GA]); store.connect("A", async () => {});
    calls[0].resolve(bundle()); calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    store.removeSeats(first);
    await vi.advanceTimersByTimeAsync(ttl - 1);
    const warm = Symbol(); store.setSeats(warm, [GA]);
    expect(store.getSnapshot().countsReady.has(keyOf(GA))).toBe(true);
    expect(store.getSnapshot().races.get(keyOf(GA))?.total).toBe(100);
    calls.findLast((call) => call.path === "/api/ddhq/races")!.resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    store.removeSeats(warm);
    await vi.advanceTimersByTimeAsync(ttl + 1);
    store.setSeats(Symbol(), [GA]);
    expect(store.getSnapshot().countsReady.has(keyOf(GA))).toBe(false);
    expect(store.getSnapshot().countsFailed.has(keyOf(GA))).toBe(false);
    expect(store.getSnapshot().countsFetchedAt).toBeNull();
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ candidates: null, forecast: [{ probability: 0.7 }] });
    const call = { name: "Candidate", at: "2026-11-04T01:02:03Z" };
    const fresh = { ...count, total: 200, call, candidates: count.candidates!.map((candidate) => ({ ...candidate, votes: 200, winner: true })) };
    calls.findLast((request) => request.path === "/api/ddhq/races")!.resolve({ races: [{ key: keyOf(GA), race: fresh }] }); await settled();
    expect(store.getSnapshot().countsReady.has(keyOf(GA))).toBe(true);
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ total: 200, call });
    expect(store.getSnapshot().countsFetchedAt).toBe(Date.now());
    keeper();
  });

  it("reports the oldest successful check among active ready seats instead of the latest unrelated batch", async () => {
    const { store, calls } = setup(); const first = Symbol(); const second = Symbol();
    store.setSeats(first, [GA]); store.connect("A", async () => {});
    const initial = Date.now();
    calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    await vi.advanceTimersByTimeAsync(5_000);
    store.setSeats(second, [MI]);
    calls[2].resolve({ races: [{ key: keyOf(MI), race: count }] }); await settled();
    expect(store.getSnapshot().countsFetchedAt).toBe(initial);
    store.removeSeats(first);
    expect(store.getSnapshot().countsFetchedAt).toBe(initial + 5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    store.setSeats(first, [GA]);
    expect(store.getSnapshot().countsFetchedAt).toBe(initial);
    calls[3].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    expect(store.getSnapshot().countsFetchedAt).toBe(initial + 5_000);
  });

  it("adapts count polling from 30 seconds to 15 seconds on election day and publishes new calls", async () => {
    vi.setSystemTime(Date.parse("2026-11-03T04:59:45Z"));
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    const before = store.getSnapshot().countsFetchedAt!;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls[2].path).toBe("/api/ddhq/races");
    const call = { name: "Candidate", at: "2026-11-03T05:00:15Z" };
    calls[2].resolve({ races: [{ key: keyOf(GA), race: { ...count, call, candidates: count.candidates!.map((candidate) => ({ ...candidate, winner: true })) } }] }); await settled();
    expect(store.getSnapshot().races.get(keyOf(GA))?.call).toEqual(call);
    expect(store.getSnapshot().countsFetchedAt).toBeGreaterThan(before);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls[3].path).toBe("/api/ddhq/races");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(4);
  });

  it("reports initial failure between retries, then loading and successful recovery", async () => {
    const { store, calls } = setup();
    expect(store.getSnapshot()).toMatchObject({ forecastStatus: "idle", forecastError: null });
    store.connect("A", async () => {});
    expect(store.getSnapshot()).toMatchObject({ forecastStatus: "loading", forecastError: null });
    const message = "Decision Desk HQ's published forecast is unavailable.";
    calls[0].reject(Object.assign(new Error(message), { status: 502 }));
    await settled();
    expect(store.getSnapshot()).toMatchObject({ forecast: null, forecastStatus: "error", forecastError: message });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(calls).toHaveLength(1);
    expect(store.getSnapshot().forecastStatus).toBe("error");
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({ forecastStatus: "loading", forecastError: message });
    calls[1].resolve(bundle()); await settled();
    expect(store.getSnapshot()).toMatchObject({ forecastStatus: "ready", forecastError: null, forecast: { source: "ddhq" } });
  });

  it("does not publish raw transport exception details as a forecast error", async () => {
    const { store, calls } = setup();
    store.connect("A", async () => {});
    calls[0].reject(new Error("transport contains private request details")); await settled();
    expect(store.getSnapshot().forecastStatus).toBe("error");
    expect(store.getSnapshot().forecastError).toBe("Decision Desk HQ's published forecast is unavailable.");
  });

  it("clears loading and errors on disconnect or account switch and ignores late failures", async () => {
    const { store, calls } = setup();
    store.connect("A", async () => {});
    calls[0].reject(Object.assign(new Error("A's safe API error"), { status: 502 })); await settled();
    expect(store.getForOwner("B")).toMatchObject({ forecastStatus: "idle", forecastError: null });
    store.connect("B", async () => {});
    expect(store.getSnapshot()).toMatchObject({ owner: "B", forecastStatus: "loading", forecastError: null });
    store.disconnect();
    expect(store.getSnapshot()).toMatchObject({ forecastStatus: "idle", forecastError: null });
    calls[1].reject(Object.assign(new Error("B's late error"), { status: 502 })); await settled();
    expect(store.getSnapshot()).toBe(EMPTY_DESK);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes the complete forecast without waiting for counts and merges independent fields", async () => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]);
    store.connect("A", async () => {});
    expect(calls.map((call) => call.path)).toEqual(["/api/ddhq/forecast", "/api/ddhq/races"]);
    calls[0].resolve(bundle());
    await settled();
    expect(store.getSnapshot().forecast?.source).toBe("ddhq");
    expect(store.getSnapshot().races.get(keyOf(GA))?.forecast[0].probability).toBe(0.7);
    expect(calls[1].path).toBe("/api/ddhq/races");
    calls[1].resolve({ races: [{ key: keyOf(GA), race: { ...count, forecast: [{ name: "Old", party: "R", probability: 0.9 }] } }] });
    await settled();
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ total: 100, forecast: [{ name: "Candidate", probability: 0.7 }] });
  });

  it("unions and deduplicates consumers, including at-large seats, without refetching unchanged rows", async () => {
    const { store, calls } = setup();
    const first = Symbol(); const second = Symbol();
    const house: DdhqSeat = { state: "AK", office: "house", district: null, special: false };
    store.setSeats(first, [GA, house]);
    store.setSeats(second, [GA, MI, { ...house, district: 0 }]);
    store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    expect((calls[1].body as { seats: DdhqSeat[] }).seats).toHaveLength(3);
    calls[1].resolve({ races: [] }); await settled();
    store.setSeats(first, [{ ...GA }, { ...house }]);
    expect(calls).toHaveLength(2);
    store.removeSeats(first);
    await vi.advanceTimersByTimeAsync(60_000);
    const batch = calls.findLast((call) => call.path === "/api/ddhq/races")!;
    expect((batch.body as { seats: DdhqSeat[] }).seats.map(keyOf).sort()).toEqual([keyOf(GA), keyOf(MI), keyOf(house)].sort());
  });

  it("fetches newly registered seats promptly without overlapping a count request", async () => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    store.setSeats(Symbol(), [MI]);
    expect(calls).toHaveLength(2);
    calls[1].resolve({ races: [] }); await settled();
    expect(calls).toHaveLength(3);
    expect(calls[2].body).toEqual({ seats: [MI] });
    calls[2].resolve({ races: [] }); await settled();
    store.setSeats(Symbol(), [{ ...GA, state: "NC" }]);
    expect(calls).toHaveLength(4);
  });

  it("continues later count batches after an early batch fails", async () => {
    const { store, calls } = setup();
    const seats = Array.from({ length: 513 }, (_, i): DdhqSeat => ({ state: "CA", office: "house", district: i + 1, special: false }));
    store.setSeats(Symbol(), seats); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    calls[1].reject({ status: 502 }); await settled();
    expect((calls[2].body as { seats: DdhqSeat[] }).seats).toEqual([seats[512]]);
    calls[2].resolve({ races: [{ key: keyOf(seats[512]), race: count }] }); await settled();
    expect(store.getSnapshot().races.get(keyOf(seats[512]))?.total).toBe(100);
    expect(store.getSnapshot().forecast).not.toBeNull();
  });

  it("fetches all 435 House seats in one authenticated request and handles partial failures per seat", async () => {
    const { store, calls } = setup();
    const seats = Array.from({ length: 435 }, (_, i): DdhqSeat => ({ state: "CA", office: "house", district: i + 1, special: false }));
    store.setSeats(Symbol(), seats); store.connect("A", async () => {});
    expect(calls).toHaveLength(2);
    expect((calls[1].body as { seats: DdhqSeat[] }).seats).toHaveLength(435);
    calls[1].resolve({ races: seats.map((seat, i) => ({ key: keyOf(seat), race: i < 24 ? null : count })) }); await settled();
    expect(store.getSnapshot().countsReady.size).toBe(411);
    expect(store.getSnapshot().countsFailed.size).toBe(24);
    expect(calls.filter((call) => call.path === "/api/ddhq/races")).toHaveLength(1);
  });

  it("splits more than 512 seats sequentially and includes newly queued seats in the next request", async () => {
    const { store, calls } = setup();
    const seats = Array.from({ length: 600 }, (_, i): DdhqSeat => ({ state: "CA", office: "house", district: i + 1, special: false }));
    store.setSeats(Symbol(), seats); store.connect("A", async () => {});
    expect(calls).toHaveLength(2);
    expect((calls[1].body as { seats: DdhqSeat[] }).seats).toHaveLength(512);
    store.setSeats(Symbol(), [MI]);
    expect(calls).toHaveLength(2);
    calls[1].resolve({ races: seats.slice(0, 512).map((seat) => ({ key: keyOf(seat), race: count })) }); await settled();
    expect(calls).toHaveLength(3);
    expect((calls[2].body as { seats: DdhqSeat[] }).seats).toEqual([...seats.slice(512), MI]);
    expect(store.getSnapshot().countsReady.size).toBe(512);
    calls[2].resolve({ races: [...seats.slice(512), MI].map((seat) => ({ key: keyOf(seat), race: count })) }); await settled();
    expect(store.getSnapshot().countsReady.size).toBe(601);
  });

  it("cancels an old board request and never launches its remainder after an account switch or disconnect", async () => {
    const { store, calls } = setup();
    const seats = Array.from({ length: 600 }, (_, i): DdhqSeat => ({ state: "CA", office: "house", district: i + 1, special: false }));
    store.setSeats(Symbol(), seats); store.connect("A", async () => {});
    store.connect("B", async () => {});
    expect(calls).toHaveLength(4);
    expect(calls[1].signal.aborted).toBe(true);
    calls[1].resolve({ races: seats.slice(0, 512).map((seat) => ({ key: keyOf(seat), race: count })) });
    await settled();
    expect(calls).toHaveLength(4);
    expect(store.getSnapshot().owner).toBe("B");
    expect(store.getSnapshot().countsReady.size).toBe(0);
    expect(store.getSnapshot().countsFailed.size).toBe(0);
    store.disconnect();
    expect(calls[3].signal.aborted).toBe(true);
    calls[3].resolve({ races: seats.slice(0, 512).map((seat) => ({ key: keyOf(seat), race: count })) }); await settled();
    expect(calls).toHaveLength(4);
    expect(store.getSnapshot()).toBe(EMPTY_DESK);
  });

  it("keeps reporting and count timestamps through count-only and forecast-merged snapshots", async () => {
    const { store, calls } = setup();
    const metadata = {
      reporting: 63, resultsUpdatedAt: "2026-11-04T01:02:03Z",
      counties: [{ fips: "13001", name: "Appling", total: 100, reporting: 84, candidates: [{ name: "Candidate", party: "D", votes: 100, pct: 100 }] }],
    };
    const upstream = { ...count, ...metadata };
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    calls[1].resolve({ races: [{ key: keyOf(GA), race: upstream }] }); await settled();
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ ...metadata, forecast: [] });
    expect(store.getSnapshot().races.get(keyOf(GA))).not.toHaveProperty("rating");
    expect(store.getSnapshot().races.get(keyOf(GA))).not.toHaveProperty("updatedAt");
    expect(upstream.rating).toBe("lean-d");
    calls[0].resolve(bundle([{ key: keyOf(GA), race: race({ rating: "tossup", updatedAt: 777 }) }])); await settled();
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ ...metadata, forecast: [{ probability: 0.7 }], rating: "tossup", updatedAt: 777 });
  });

  it("retains a removed consumer's late counts in the same owner's tracker cache", async () => {
    const { store, calls } = setup(); const source = Symbol();
    store.setSeats(source, [GA]); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    store.removeSeats(source);
    calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ total: 100, forecast: [{ probability: 0.7 }] });
    expect(store.getSnapshot().countsReady.has(keyOf(GA))).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.filter((call) => call.path === "/api/ddhq/races")).toHaveLength(1);
  });

  it.each(["null", "error"])("removes stale counts on %s while retaining fresh published forecasts", async (failure) => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    await vi.advanceTimersByTimeAsync(60_000);
    const next = calls.findLast((call) => call.path === "/api/ddhq/races")!;
    if (failure === "null") next.resolve({ races: [{ key: keyOf(GA), race: null }] });
    else next.reject({ status: 502 });
    await settled();
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ candidates: null, total: 0, forecast: [{ probability: 0.7 }] });
  });

  it("removes a failed forecast bundle without resurrecting forecasts carried by count responses", async () => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    await vi.advanceTimersByTimeAsync(60_000);
    calls.findLast((call) => call.path === "/api/ddhq/forecast")!.reject({ status: 502 });
    await settled();
    expect(store.getSnapshot().forecast).toBeNull();
    expect(store.getSnapshot().forecastStatus).toBe("error");
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ total: 100, forecast: [] });
    expect(store.getSnapshot().races.get(keyOf(GA))?.rating).toBeUndefined();
  });

  it("hides other owners synchronously and ignores their late forecast and count responses", async () => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    expect(store.getForOwner("B")).toBe(EMPTY_DESK);
    expect(store.getForOwner(null)).toBe(EMPTY_DESK);
    store.connect("B", async () => {});
    expect(calls[1].signal.aborted).toBe(true);
    calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    expect(store.getSnapshot().races.size).toBe(0);
    expect(store.getSnapshot().countsReady.size).toBe(0);
    expect(store.getSnapshot().countsFailed.size).toBe(0);
    expect(store.getSnapshot().countsFetchedAt).toBeNull();
    store.disconnect();
    calls[2].resolve(bundle()); await settled();
    expect(store.getSnapshot()).toBe(EMPTY_DESK);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rapid off/on for the same owner cannot revive a cancelled loop", async () => {
    const { store, calls } = setup();
    store.connect("A", async () => {});
    store.disconnect(); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    expect(store.getSnapshot().forecast).toBeNull();
    calls[1].resolve(bundle()); await settled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(3);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[2].signal.aborted).toBe(false);
  });

  it("never overlaps forecast refreshes or count scans when responses take longer than a minute", async () => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]); store.connect("A", async () => {});
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(2);
    calls[0].resolve(bundle()); await settled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.filter((call) => call.path === "/api/ddhq/races")).toHaveLength(1);
    expect(calls.filter((call) => call.path === "/api/ddhq/forecast")).toHaveLength(2);
  });

  it("clears and refreshes account state only on 401", async () => {
    const { store, calls } = setup(); const refresh = vi.fn(async () => {});
    store.setSeats(Symbol(), [GA]); store.connect("A", refresh);
    calls[0].resolve(bundle()); await settled();
    calls[1].reject({ status: 401 }); await settled();
    expect(store.getSnapshot()).toBe(EMPTY_DESK);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops private work when the last subscriber leaves", async () => {
    const { store, calls } = setup(); const one = store.subscribe(() => {}); const two = store.subscribe(() => {});
    store.connect("A", async () => {}); one();
    expect(calls[0].signal.aborted).toBe(false);
    two();
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].resolve(bundle()); await settled();
    expect(store.getSnapshot()).toBe(EMPTY_DESK);
  });
});
