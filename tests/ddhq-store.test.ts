import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeskStore, EMPTY_DESK } from "../lib/ddhq/store";
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

async function settled() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("private DDHQ store", () => {
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

  it("publishes the complete forecast before waiting for counts and merges independent fields", async () => {
    const { store, calls } = setup();
    store.setSeats(Symbol(), [GA]);
    store.connect("A", async () => {});
    expect(calls.map((call) => call.path)).toEqual(["/api/ddhq/forecast"]);
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
    const seats = Array.from({ length: 25 }, (_, i): DdhqSeat => ({ state: "CA", office: "house", district: i + 1, special: false }));
    store.setSeats(Symbol(), seats); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    calls[1].reject({ status: 502 }); await settled();
    expect((calls[2].body as { seats: DdhqSeat[] }).seats).toEqual([seats[24]]);
    calls[2].resolve({ races: [{ key: keyOf(seats[24]), race: count }] }); await settled();
    expect(store.getSnapshot().races.get(keyOf(seats[24]))?.total).toBe(100);
    expect(store.getSnapshot().forecast).not.toBeNull();
  });

  it("ignores a removed consumer's late counts without removing the independent forecast", async () => {
    const { store, calls } = setup(); const source = Symbol();
    store.setSeats(source, [GA]); store.connect("A", async () => {});
    calls[0].resolve(bundle()); await settled();
    store.removeSeats(source);
    calls[1].resolve({ races: [{ key: keyOf(GA), race: count }] }); await settled();
    expect(store.getSnapshot().races.get(keyOf(GA))).toMatchObject({ candidates: null, total: 0, forecast: [{ probability: 0.7 }] });
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
    expect(calls).toHaveLength(1);
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
