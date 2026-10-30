import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isNewer } from "../lib/midterms/live";
import type { Db } from "../lib/auth/accounts";
import { resetCallsMemo } from "../lib/midterms/calls";
import { overview } from "../lib/midterms/catalog";
import { resetCivicMemo, SERVE_STALE_MS, WAIT_MS } from "../lib/midterms/civic";
import { resetHistoryMemo } from "../lib/midterms/history";
import { FIRST_POLLS_OPEN } from "../lib/midterms/races";
import { testDb } from "./sqlite-db";

// Election night as a page sees it: a sequence of civicAPI answers through overview(), polled the way the client
// polls, with background work run to completion between polls (as Workers' waitUntil does).

const NIGHT = Date.parse("2026-11-04T01:00:00Z");
const MINUTE = 60_000;

type Cand = { name: string; party: string; votes: number; winner: boolean };
const senate = (id: number, state: string, name: string, reporting: number, candidates: Cand[]) => ({
  id,
  type: "US Senate",
  country: "US",
  province: state,
  district: null,
  municipality: null,
  election_name: `${name} US Senate`,
  election_type: "Statewide",
  election_date: "2026-11-03T05:00:00.000Z",
  percent_reporting: reporting,
  candidates,
});
const ga = (reporting: number, dem: number, rep: number, winner: "D" | "R" | null) =>
  senate(1, "GA", "Georgia", reporting, [
    { name: "Jon Ossoff", party: "Democratic", votes: dem, winner: winner === "D" },
    { name: "Mike Collins", party: "Republican", votes: rep, winner: winner === "R" },
  ]);
const nc = (reporting: number) =>
  senate(2, "NC", "North Carolina", reporting, [
    { name: "Roy Cooper", party: "Democratic", votes: reporting * 100, winner: false },
    { name: "Michael Whatley", party: "Republican", votes: reporting * 90, winner: false },
  ]);

let answer: { senate: unknown[] } | "down" | "hang" = { senate: [] };

beforeEach(() => {
  resetCivicMemo();
  resetCallsMemo();
  resetHistoryMemo();
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    // Markets and polls for the background ratings refresh: nothing to report.
    if (!url.hostname.includes("civicapi")) return new Response("[]");
    if (answer === "down") return new Response("down", { status: 503 });
    if (answer === "hang") return new Promise<Response>(() => {});
    const type = url.searchParams.get("type");
    return new Response(JSON.stringify({ races: type === "US Senate" ? answer.senate : [] }));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One poll at `now`: the page's answer, after the work it started in the background has finished. */
async function poll(db: Db, now: number) {
  const work: Promise<unknown>[] = [];
  const page = await overview(db, now, (w) => work.push(w));
  await Promise.allSettled(work);
  return page;
}

/** Polls twice, a second apart: the first may be served from memory while it refreshes; the second sees the refresh. */
async function settle(db: Db, now: number) {
  await poll(db, now);
  return poll(db, now + 1000);
}

const georgia = (page: Awaited<ReturnType<typeof overview>>) => page.races.find((r) => r.id === 1)!;

describe("election night, poll by poll", () => {
  it("follows a race from no votes through a call, a withdrawn call and civicAPI leaving it out", async () => {
    const db = testDb();

    // Before the polls open, any numbers civicAPI already has are blanked.
    answer = { senate: [ga(3, 500, 400, null), nc(0)] };
    const before = await settle(db, FIRST_POLLS_OPEN - MINUTE);
    expect(georgia(before)).toMatchObject({ reporting: 0, total: 0 });
    expect(georgia(before).candidates.every((c) => c.votes === 0 && !c.winner)).toBe(true);
    expect(before.callEvents).toEqual([]);

    // Partial counts arrive; the next poll after a refresh shows them.
    answer = { senate: [ga(40, 52_000, 48_000, null), nc(10)] };
    const counting = await settle(db, NIGHT);
    expect(counting.stale).toBe(false);
    expect(georgia(counting)).toMatchObject({ reporting: 40, total: 100_000 });
    expect(georgia(counting).call).toBeNull();

    // civicAPI's desk calls it.
    answer = { senate: [ga(85, 120_000, 100_000, "D"), nc(30)] };
    const called = await settle(db, NIGHT + 5 * MINUTE);
    expect(georgia(called).candidates.find((c) => c.winner)?.name).toBe("Jon Ossoff");
    expect(georgia(called).call).toMatchObject({ winner: "Jon Ossoff", withdrawn: false });
    expect(called.callEvents.map((e) => e.kind)).toEqual(["call"]);

    // The call is pulled back.
    answer = { senate: [ga(88, 124_000, 110_000, null), nc(40)] };
    const withdrawn = await settle(db, NIGHT + 10 * MINUTE);
    expect(georgia(withdrawn).candidates.some((c) => c.winner)).toBe(false);
    expect(georgia(withdrawn).call).toMatchObject({ winner: null, withdrawn: true, replaced: "Jon Ossoff" });
    expect(withdrawn.callEvents.map((e) => e.kind)).toEqual(["withdrawal", "call"]);

    // civicAPI leaves Georgia out: it stays listed with its last numbers, marked missing, and no call is invented.
    answer = { senate: [nc(50)] };
    const dropped = await settle(db, NIGHT + 15 * MINUTE);
    expect(georgia(dropped)).toMatchObject({ missing: true, reporting: 88, total: 234_000 });
    expect(dropped.coverage.senate.missing).toBe(1);
    expect(dropped.callEvents).toHaveLength(2);
    expect(dropped.races.find((r) => r.id === 2)).toMatchObject({ reporting: 50 });
  });

  it("serves the last results marked stale when civicAPI is down, then recovers", async () => {
    const db = testDb();
    answer = { senate: [ga(40, 52_000, 48_000, null)] };
    await settle(db, NIGHT);
    answer = "down";
    // Within SERVE_STALE_MS the page gets the recent copy while the refresh fails behind it.
    expect(await poll(db, NIGHT + MINUTE)).toMatchObject({ stale: false });
    const down = await poll(db, NIGHT + SERVE_STALE_MS + MINUTE);
    expect(down.stale).toBe(true);
    expect(georgia(down)).toMatchObject({ reporting: 40 });
    answer = { senate: [ga(60, 70_000, 66_000, null)] };
    const back = await settle(db, NIGHT + SERVE_STALE_MS + 2 * MINUTE);
    expect(back).toMatchObject({ stale: false });
    expect(georgia(back)).toMatchObject({ reporting: 60 });
  });

  it("answers within WAIT_MS with the last results when civicAPI hangs", async () => {
    const db = testDb();
    answer = { senate: [ga(40, 52_000, 48_000, null)] };
    await settle(db, NIGHT);
    answer = "hang";
    vi.useFakeTimers();
    const pending = overview(db, NIGHT + SERVE_STALE_MS + MINUTE, () => {});
    await vi.advanceTimersByTimeAsync(WAIT_MS + 10);
    const page = await pending;
    expect(page.stale).toBe(true);
    expect(georgia(page)).toMatchObject({ reporting: 40 });
  });

  it("never records a call change from results pieced together from stored snapshots", async () => {
    const db = testDb();
    answer = { senate: [ga(85, 120_000, 100_000, "D")] };
    await settle(db, NIGHT);
    // A stored row lagging behind (an isolate's write held back by the once-a-minute limit) shows no winner yet,
    // and is newer than the last catalog recorded.
    const row = (await db.prepare("SELECT data FROM midterm_race_snapshots WHERE race_id = 1").first<{ data: string }>())!;
    const lagging = JSON.parse(row.data);
    lagging.candidates = lagging.candidates.map((c: { winner: boolean }) => ({ ...c, winner: false }));
    await db.prepare("UPDATE midterm_race_snapshots SET data = ?, fetched_at = ? WHERE race_id = 1").bind(JSON.stringify(lagging), NIGHT + 30_000).run();
    // A fresh isolate serves that stored copy at once; it must not log a withdrawal from it.
    resetCivicMemo();
    resetCallsMemo();
    const work: Promise<unknown>[] = [];
    const page = await overview(db, NIGHT + 40_000, (w) => work.push(w));
    await Promise.allSettled(work);
    expect(page.callEvents.map((e) => e.kind)).toEqual(["call"]);
    const kinds = (await db.prepare("SELECT winner FROM midterm_call_events WHERE race_id = 1 ORDER BY id").all<{ winner: string | null }>()).results;
    expect(kinds).toEqual([{ winner: "Jon Ossoff" }]);
  });
});

describe("the page keeps the newest results", () => {
  it("drops an answer older than the one on screen", () => {
    expect(isNewer({ fetchedAt: 2000 }, { fetchedAt: 1000 })).toBe(false);
    expect(isNewer({ fetchedAt: 1000 }, { fetchedAt: 2000 })).toBe(true);
    expect(isNewer({ fetchedAt: 1000 }, { fetchedAt: 1000 })).toBe(true);
    // Answers without a time (other endpoints) always replace.
    expect(isNewer(null, { fetchedAt: 1 })).toBe(true);
    expect(isNewer({ items: [] }, { items: [1] })).toBe(true);
  });
});
