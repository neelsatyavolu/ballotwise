import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../lib/auth/accounts";
import { raceHistory, recordHistory, resetHistoryMemo } from "../lib/midterms/history";
import type { RaceSummary } from "../lib/midterms/races";
import { testDb } from "./sqlite-db";

const T = Date.parse("2026-11-04T02:00:00Z");
const MIN = 60 * 1000;

/** A race with Alice and Bob at these vote counts. */
function race(id: number, alice: number, bob: number, reporting = 50): RaceSummary {
  const total = alice + bob;
  const candidate = (name: string, party: string, votes: number) => ({ name, party, votes, pct: total ? Math.round((votes / total) * 10000) / 100 : 0, winner: false, incumbent: false });
  return { id, office: "senate", state: "PA", district: null, title: "Pennsylvania Senate", reporting, total, candidates: [candidate("Alice", "DEM", alice), candidate("Bob", "REP", bob)], rating: null };
}

/** Records a fresh catalog fetched at `at` (served at `now`, by default the same time). */
const record = (db: Db, races: RaceSummary[], at: number, now = at, stale = false) => recordHistory(db, { races, fetchedAt: at, stale }, now);
const totals = async (db: Db, id: number) => (await raceHistory(db, id, 100)).map((o) => [o.total, o.at]);

describe("recordHistory", () => {
  afterEach(() => {
    resetHistoryMemo();
    vi.restoreAllMocks();
  });

  it("records a race only when its votes change, and never a race with no votes", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400), race(2, 0, 0)], T);
    await record(db, [race(1, 600, 400), race(2, 0, 0)], T + 10 * MIN);
    await record(db, [race(1, 700, 400), race(2, 0, 0)], T + 20 * MIN);
    expect(await totals(db, 1)).toEqual([[1100, T + 20 * MIN], [1000, T]]);
    expect(await raceHistory(db, 2)).toEqual([]);
  });

  it("stores the leader, their lead from raw votes, and unknown reporting as null", async () => {
    const db = testDb();
    await record(db, [race(1, 400, 600, 37), { ...race(2, 2, 1), reportingUnknown: true }], T);
    expect(await raceHistory(db, 1)).toEqual([{ at: T, total: 1000, leadName: "Bob", leadParty: "REP", margin: 20, reporting: 37, corrected: false }]);
    const [unknown] = await raceHistory(db, 2);
    expect(unknown.reporting).toBeNull();
    expect(unknown.margin).toBeCloseTo(100 / 3, 10);
  });

  it("samples vote additions at most every 5 minutes", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400)], T);
    await record(db, [race(1, 650, 400)], T + 2 * MIN);
    await record(db, [race(1, 700, 400)], T + 4 * MIN);
    await record(db, [race(1, 800, 400)], T + 5 * MIN);
    expect(await totals(db, 1)).toEqual([[1200, T + 5 * MIN], [1000, T]]);
  });

  it("records a leader change right away", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400)], T);
    await record(db, [race(1, 600, 700)], T + 1 * MIN);
    expect(await raceHistory(db, 1)).toMatchObject([{ at: T + 1 * MIN, leadName: "Bob", corrected: false }, { at: T }]);
  });

  it("records a correction right away, even when the total doesn't change", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400)], T);
    await record(db, [race(1, 550, 450)], T + 1 * MIN);
    expect(await raceHistory(db, 1)).toMatchObject([{ at: T + 1 * MIN, total: 1000, corrected: true }, { at: T, corrected: false }]);
  });

  it("compares the current numbers with the race's numbers as of 15 minutes ago", async () => {
    const db = testDb();
    await record(db, [race(1, 550, 450)], T);
    await record(db, [race(1, 800, 700)], T + 5 * MIN);
    await record(db, [race(1, 1000, 1000)], T + 10 * MIN);
    const trend = (await record(db, [race(1, 1500, 1100)], T + 20 * MIN)).get(1);
    // 15 minutes before T+20 is T+5, the baseline.
    expect(trend).toMatchObject({ since: T + 5 * MIN, baselineAt: T + 5 * MIN, votesAdded: 1100, prevLeader: "Alice", lastChange: T + 20 * MIN });
    expect(trend?.prevMargin).toBeCloseTo(100 / 15, 10);
    // Later, with no new votes, the baseline is the current state, so there's no trend.
    expect((await record(db, [race(1, 1500, 1100)], T + 40 * MIN)).has(1)).toBe(false);
  });

  it("counts votes the sampling hasn't recorded yet, against the oldest observation when all are newer", async () => {
    const db = testDb();
    expect((await record(db, [race(1, 600, 400)], T)).has(1)).toBe(false);
    expect((await record(db, [race(1, 700, 400)], T + 2 * MIN)).get(1)).toEqual({ since: T, baselineAt: T, votesAdded: 100, prevMargin: 20, prevLeader: "Alice", lastChange: T });
  });

  it("keeps a correction's vote change negative", async () => {
    const db = testDb();
    await record(db, [race(1, 1200, 800)], T);
    expect((await record(db, [race(1, 1000, 800)], T + 1 * MIN)).get(1)).toMatchObject({ votesAdded: -200, lastChange: T + 1 * MIN });
  });

  it("gives a fresh isolate the same trend from the stored observations", async () => {
    const db = testDb();
    for (let i = 0; i <= 8; i++) await record(db, [race(1, 1000 + i * 100, 1000)], T + i * 5 * MIN);
    const now = T + 42 * MIN;
    const warm = (await record(db, [race(1, 1800, 1000)], T + 40 * MIN, now)).get(1);
    resetHistoryMemo();
    expect((await record(db, [race(1, 1800, 1000)], T + 40 * MIN, now, true)).get(1)).toEqual(warm);
    expect(warm).toMatchObject({ baselineAt: T + 25 * MIN, votesAdded: 300 });
  });

  it("doesn't observe races civicAPI left out of its answer", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400)], T);
    await record(db, [{ ...race(1, 900, 400), missing: true }], T + 10 * MIN);
    expect(await totals(db, 1)).toEqual([[1000, T]]);
  });

  it("writes nothing from a stale catalog", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400)], T);
    await record(db, [race(1, 900, 400)], T + 10 * MIN, T + 10 * MIN, true);
    resetHistoryMemo();
    await record(db, [race(1, 900, 400)], T + 20 * MIN, T + 20 * MIN, true);
    expect(await totals(db, 1)).toEqual([[1000, T]]);
  });

  it("ignores a catalog fetched no later than the last one processed, here and in other isolates", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400), race(2, 600, 400)], T);
    await record(db, [race(1, 700, 400), race(2, 600, 400)], T + 20 * MIN);
    // Race 2 last changed at T, so only the processed-through time stops this older catalog's change to it.
    await record(db, [race(1, 700, 400), race(2, 900, 400)], T + 10 * MIN, T + 30 * MIN);
    resetHistoryMemo();
    await record(db, [race(1, 700, 400), race(2, 900, 400)], T + 10 * MIN, T + 40 * MIN);
    expect(await totals(db, 2)).toEqual([[1000, T]]);
  });

  it("refuses an older differing catalog once a newer unchanged one was processed elsewhere", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400)], T);
    await record(db, [race(1, 600, 400)], T + 20 * MIN);
    resetHistoryMemo();
    await record(db, [race(1, 900, 400)], T + 10 * MIN, T + 30 * MIN);
    expect(await totals(db, 1)).toEqual([[1000, T]]);
  });

  it("durably processes a newer unchanged catalog seen between syncs, so an older differing one is refused", async () => {
    const db = testDb();
    await record(db, [race(1, 600, 400)], T);
    await record(db, [race(1, 600, 400)], T + 15_000);
    resetHistoryMemo();
    // A correction skips the 5-minute gap, so only the watermark stops it.
    await record(db, [race(1, 500, 400)], T + 10_000, T + 60_000);
    expect(await totals(db, 1)).toEqual([[1000, T]]);
  });

  it("returns a race's latest observations, newest first, up to the limit", async () => {
    const db = testDb();
    for (let i = 0; i < 15; i++) await record(db, [race(1, 100 + i, 100)], T + i * 5 * MIN);
    const history = await raceHistory(db, 1);
    expect(history).toHaveLength(12);
    expect(history[0]).toMatchObject({ total: 214, at: T + 70 * MIN });
    expect(history[11]).toMatchObject({ total: 203 });
    expect(await raceHistory(db, 1, 2)).toHaveLength(2);
  });

  it("never throws when the database fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: Db = {
      prepare: () => {
        throw new Error("D1 is down");
      },
      batch: async () => {
        throw new Error("D1 is down");
      },
    };
    expect((await record(broken, [race(1, 600, 400)], T)).size).toBe(0);
    expect(await raceHistory(broken, 1)).toEqual([]);
    expect(error).toHaveBeenCalled();
  });
});
