import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../lib/auth/accounts";
import { agrees, callHistory, listCallEvents, recordCalls, resetCallsMemo } from "../lib/midterms/calls";
import { withCall } from "../lib/midterms/catalog";
import { FRESH_MS } from "../lib/midterms/civic";
import type { Office, RaceSummary } from "../lib/midterms/races";
import { testDb } from "./sqlite-db";

const T = Date.parse("2026-11-04T02:00:00Z");
/** The time of the nth step, each far enough apart that every step syncs with the database. */
const step = (n: number) => T + n * 2 * FRESH_MS;

/** A race with `winner` called, or uncalled when it's null. */
function race(id: number, winner: string | null, office: Office = "senate"): RaceSummary {
  const candidate = (name: string, party: string) => ({ name, party, votes: 100, pct: 50, winner: name === winner, incumbent: false });
  return { id, office, state: "PA", district: null, title: "Pennsylvania Senate", reporting: 50, total: 200, candidates: [candidate("Alice", "DEM"), candidate("Bob", "REP")], rating: null };
}

/** Records a fresh catalog fetched at `at` (served at `now`, by default the same time). */
const record = (db: Db, races: RaceSummary[], at: number, now = at, stale = false) => recordCalls(db, { races, fetchedAt: at, stale }, now);

/** Runs race 1 through `winners`, one step each, and returns its final call. */
async function sequence(db: Db, winners: (string | null)[]) {
  let call = null;
  for (const [i, winner] of winners.entries()) call = (await record(db, [race(1, winner)], step(i))).calls.get(1) ?? null;
  return call;
}

/** Wraps `db`, counting statements prepared and inserts among them. */
function counted(db: Db) {
  const count = { prepared: 0, inserts: 0 };
  const wrapped: Db = { prepare: (sql) => (count.prepared++, sql.startsWith("INSERT INTO midterm_call_events") && count.inserts++, db.prepare(sql)), batch: db.batch };
  return { count, db: wrapped };
}

const broken: Db = {
  prepare: () => {
    throw new Error("D1 is down");
  },
  batch: async () => {
    throw new Error("D1 is down");
  },
};

const timeline = async (db: Db, id: number) => (await callHistory(db, id)).map((e) => [e.winner, e.at]);

describe("recordCalls", () => {
  afterEach(() => {
    resetCallsMemo();
    vi.restoreAllMocks();
  });

  it("stamps a first call with the catalog's fetch time and its event id", async () => {
    const db = testDb();
    const call = await sequence(db, ["Alice"]);
    const [event] = await callHistory(db, 1);
    expect(event).toEqual({ id: expect.any(Number), raceId: 1, office: "senate", kind: "call", winner: "Alice", party: "DEM", previous: null, at: step(0) });
    expect(call).toEqual({ id: event.id, at: step(0), winner: "Alice", replaced: null, withdrawn: false });
  });

  it("keeps the original time while the call holds, even in a fresh isolate", async () => {
    const db = testDb();
    expect(await sequence(db, ["Alice", "Alice", "Alice"])).toMatchObject({ at: step(0), replaced: null, withdrawn: false });
    resetCallsMemo();
    expect((await record(db, [race(1, "Alice")], step(5))).calls.get(1)).toMatchObject({ at: step(0) });
    expect(await callHistory(db, 1)).toHaveLength(1);
  });

  it("gives a changed call a new time and names the winner it replaced", async () => {
    expect(await sequence(testDb(), ["Alice", "Bob"])).toMatchObject({ at: step(1), replaced: "Alice", withdrawn: false });
  });

  it("records a call that flips back as a new change", async () => {
    const db = testDb();
    expect(await sequence(db, ["Alice", "Bob", "Alice"])).toMatchObject({ at: step(2), replaced: "Bob", withdrawn: false });
    expect(await timeline(db, 1)).toEqual([["Alice", step(0)], ["Bob", step(1)], ["Alice", step(2)]]);
  });

  it("reports a withdrawn call with the withdrawn winner", async () => {
    const db = testDb();
    expect(await sequence(db, ["Alice", null, null])).toMatchObject({ at: step(1), replaced: "Alice", withdrawn: true });
    expect((await callHistory(db, 1)).at(-1)).toMatchObject({ winner: null, party: null, at: step(1) });
    resetCallsMemo();
    expect((await record(db, [race(1, null)], step(5))).calls.get(1)).toMatchObject({ at: step(1), replaced: "Alice", withdrawn: true });
  });

  it("re-calls a race after a withdrawal", async () => {
    expect(await sequence(testDb(), ["Alice", null, "Bob"])).toMatchObject({ at: step(2), replaced: "Alice", withdrawn: false });
    resetCallsMemo();
    expect(await sequence(testDb(), ["Alice", null, "Alice"])).toMatchObject({ at: step(2), replaced: null, withdrawn: false });
  });

  it("leaves never-called races out and writes nothing for them", async () => {
    const db = testDb();
    await record(db, [race(1, null), race(2, "Bob")], step(0));
    const { calls } = await record(db, [race(1, null), race(2, "Bob")], step(1));
    expect(calls.has(1)).toBe(false);
    expect(calls.get(2)).toMatchObject({ at: step(0) });
    expect(await callHistory(db, 1)).toEqual([]);
  });

  it("writes a change once when two isolates record it at the same time", async () => {
    const { db, count } = counted(testDb());
    await Promise.all([record(db, [race(1, "Alice")], T), record(db, [race(1, "Alice")], T + 1)]);
    expect(count.inserts).toBe(2);
    expect(await callHistory(db, 1)).toHaveLength(1);
  });

  it("writes nothing from a stale catalog but still reports the known call", async () => {
    const db = testDb();
    await record(db, [race(1, "Alice")], step(0));
    // A stale catalog without the call (an old snapshot) must not look like a withdrawal, warm or cold.
    expect((await record(db, [race(1, null)], step(1), step(1), true)).calls.get(1)).toMatchObject({ at: step(0), withdrawn: false });
    resetCallsMemo();
    expect((await record(db, [race(1, null)], step(2), step(2), true)).calls.get(1)).toMatchObject({ at: step(0), withdrawn: false });
    expect(await callHistory(db, 1)).toHaveLength(1);
  });

  it("ignores a catalog fetched no later than the last one processed, here and in other isolates", async () => {
    const db = testDb();
    await record(db, [race(1, "Alice")], step(2));
    expect((await record(db, [race(1, "Bob")], step(1), step(3))).calls.get(1)).toMatchObject({ at: step(2), replaced: null });
    // A fresh isolate doesn't know what was processed, so the database refuses the older catalog.
    resetCallsMemo();
    expect((await record(db, [race(1, "Bob")], step(1), step(4))).calls.get(1)).toMatchObject({ at: step(2), replaced: null });
    expect(await timeline(db, 1)).toEqual([["Alice", step(2)]]);
  });

  it("lists the latest events across races, newest first, with the same ids as the calls", async () => {
    const db = testDb();
    await record(db, [race(1, "Alice"), race(2, null)], step(0));
    await record(db, [race(1, "Alice"), race(2, "Bob")], step(1));
    const { calls, events } = await record(db, [race(1, null), race(2, "Bob")], step(2));
    expect(events.map((e) => [e.raceId, e.kind, e.winner, e.previous, e.at])).toEqual([
      [1, "withdrawal", null, "Alice", step(2)],
      [2, "call", "Bob", null, step(1)],
      [1, "call", "Alice", null, step(0)],
    ]);
    expect(events[0].id).toBe(calls.get(1)?.id);
    expect(events[1].id).toBe(calls.get(2)?.id);
  });

  it("caps the feed at 100 events", async () => {
    const races = Array.from({ length: 105 }, (_, i) => race(i + 1, "Alice"));
    const { events } = await record(testDb(), races, T);
    expect(events).toHaveLength(100);
    // Same time, so newest by id first.
    expect(events[0].id).toBeGreaterThan(events[99].id);
  });

  it("writes a change at most once per FRESH_MS", async () => {
    const { db, count } = counted(testDb());
    await record(db, [race(1, "Alice")], T);
    const afterFirst = count.prepared;
    await record(db, [race(1, "Alice")], T + 2000);
    expect(count.prepared).toBe(afterFirst);
    // A change within FRESH_MS of the last sync waits; the call stays as known until then.
    expect((await record(db, [race(1, "Bob")], T + FRESH_MS / 2)).calls.get(1)).toMatchObject({ at: T, replaced: null });
    expect(count.prepared).toBe(afterFirst);
    await record(db, [race(1, "Bob")], step(1));
    expect(count.prepared).toBeGreaterThan(afterFirst);
    expect(await timeline(db, 1)).toEqual([["Alice", T], ["Bob", step(1)]]);
  });

  it("keeps serving known calls when the database fails, and records the change once it's back", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = testDb();
    await record(db, [race(1, "Alice")], step(0));
    expect((await record(broken, [race(1, "Bob")], step(1))).calls.get(1)).toMatchObject({ at: step(0), replaced: null });
    expect(await callHistory(broken, 1)).toMatchObject([{ winner: "Alice", at: step(0) }]);
    expect(error).toHaveBeenCalled();
    expect((await record(db, [race(1, "Bob")], step(2))).calls.get(1)).toMatchObject({ at: step(2), replaced: "Alice" });
  });

  it("returns nothing, without throwing, when a fresh isolate can't reach the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, events } = await record(broken, [race(1, "Alice")], T);
    expect(calls.size).toBe(0);
    expect(events).toEqual([]);
  });

  it("doesn't observe races civicAPI left out of its answer", async () => {
    const db = testDb();
    await record(db, [race(1, "Alice"), race(2, null)], step(0));
    // Race 1's retained numbers lost the winner flag and race 2's show one; neither came from this answer.
    const { calls } = await record(db, [{ ...race(1, null), missing: true }, { ...race(2, "Bob"), missing: true }], step(1));
    expect(calls.get(1)).toMatchObject({ winner: "Alice", withdrawn: false });
    expect(calls.has(2)).toBe(false);
    expect(await callHistory(db, 2)).toEqual([]);
  });

  it("refuses an older differing catalog once a newer unchanged one was processed elsewhere", async () => {
    const db = testDb();
    await record(db, [race(1, "Alice")], step(0));
    await record(db, [race(1, "Alice")], step(2));
    resetCallsMemo();
    expect((await record(db, [race(1, "Bob")], step(1), step(3))).calls.get(1)).toMatchObject({ winner: "Alice", at: step(0) });
    expect(await timeline(db, 1)).toEqual([["Alice", step(0)]]);
  });

  it("durably processes a newer unchanged catalog seen between syncs, so an older differing one is refused", async () => {
    const { db, count } = counted(testDb());
    await record(db, [race(1, "Alice")], T);
    // Within the slack of the last processed catalog, an unchanged one costs nothing.
    const synced = count.prepared;
    await record(db, [race(1, "Alice")], T + 2000);
    expect(count.prepared).toBe(synced);
    // Further ahead but still inside FRESH_MS, it advances the watermark with one statement.
    await record(db, [race(1, "Alice")], T + FRESH_MS / 2);
    expect(count.prepared).toBe(synced + 1);
    resetCallsMemo();
    await record(db, [race(1, "Bob")], T + FRESH_MS / 4, T + FRESH_MS);
    expect(await timeline(db, 1)).toEqual([["Alice", T]]);
  });

  it("catches up on calls another isolate recorded, even with nothing new locally", async () => {
    const db = testDb();
    await record(db, [race(1, "Alice")], step(0));
    await db.prepare("INSERT INTO midterm_call_events (race_id, office, winner, party, previous, observed_at) VALUES (1, 'senate', 'Bob', 'REP', 'Alice', ?)").bind(step(0) + 5).run();
    expect((await record(db, [race(1, "Alice")], step(0), step(0) + FRESH_MS / 2, true)).calls.get(1)).toMatchObject({ winner: "Alice" });
    const { calls, events } = await record(db, [race(1, "Alice")], step(0), step(1), true);
    expect(calls.get(1)).toMatchObject({ winner: "Bob", replaced: "Alice", at: step(0) + 5 });
    expect(events[0]).toMatchObject({ kind: "change", winner: "Bob", previous: "Alice" });
  });

  it("counts events by office", async () => {
    const db = testDb();
    await record(db, [race(1, "Alice"), race(2, "Bob", "house"), race(3, null, "governor")], step(0));
    const { counts } = await record(db, [race(1, "Bob"), race(2, "Bob", "house"), race(3, null, "governor")], step(1));
    expect(counts).toEqual({ senate: 2, house: 1, governor: 0, measure: 0 });
  });

  it("pages through events newest first, by office and before an id", async () => {
    const db = testDb();
    await record(db, [race(1, "Alice"), race(2, "Bob", "house")], step(0));
    await record(db, [race(1, "Bob"), race(2, "Alice", "house")], step(1));
    await record(db, [race(1, null), race(2, "Alice", "house")], step(2));
    const senate = await listCallEvents(db, { office: "senate", limit: 50 });
    expect(senate.map((e) => e.kind)).toEqual(["withdrawal", "change", "call"]);
    expect(await listCallEvents(db, { office: "senate", before: senate[0].id, limit: 1 })).toEqual([senate[1]]);
    expect((await listCallEvents(db, { limit: 50 })).map((e) => e.office)).toEqual(["senate", "house", "senate", "house", "senate"]);
  });

  it("holds back a call that disagrees with the served race, missing races included", () => {
    const call = { id: 1, at: T, winner: "Alice", replaced: null, withdrawn: false } as const;
    expect(withCall(race(1, "Alice"), call)).toMatchObject({ call });
    expect(withCall(race(1, "Alice"), call)).not.toHaveProperty("callPending");
    expect(withCall(race(1, "Bob"), call)).toMatchObject({ call: null, callPending: true });
    expect(withCall({ ...race(1, null), missing: true }, call)).toMatchObject({ call: null, callPending: true });
    expect(withCall({ ...race(1, "Alice"), missing: true }, call)).toMatchObject({ call });
    expect(withCall(race(1, null), null)).toMatchObject({ call: null });
    expect(withCall(race(1, null), null)).not.toHaveProperty("callPending");
  });

  it("checks a call against a race's current winner", () => {
    const call = { id: 1, at: T, winner: "Alice", replaced: null, withdrawn: false } as const;
    const withdrawn = { id: 2, at: T, winner: null, replaced: "Alice", withdrawn: true } as const;
    expect(agrees(call, race(1, "Alice"))).toBe(true);
    expect(agrees(call, race(1, "Bob"))).toBe(false);
    expect(agrees(call, race(1, null))).toBe(false);
    expect(agrees(withdrawn, race(1, null))).toBe(true);
    expect(agrees(withdrawn, race(1, "Bob"))).toBe(false);
    expect(agrees(null, race(1, "Bob"))).toBe(false);
    expect(agrees(null, race(1, null))).toBe(true);
  });
});
