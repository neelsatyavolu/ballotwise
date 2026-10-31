import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../lib/auth/accounts";
import { CivicError, fetchCatalog, resetCivicMemo, RETIRED_RACE_IDS } from "../lib/midterms/civic";
import { balance } from "../lib/midterms/races";
import { testDb } from "./sqlite-db";

const NOW = 1_800_000_000_000; // 2027, after the polls opened
const MINUTE = 60_000;

const race = (id: number, type: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  type,
  country: "US",
  province: "PA",
  district: null,
  municipality: null,
  election_name: name,
  election_type: "Statewide",
  election_date: "2026-11-03T05:00:00.000Z",
  percent_reporting: 40,
  candidates: [
    { name: "Ann Lee", party: "Republican", votes: 300, winner: false },
    { name: "Bo Diaz", party: "Democratic", votes: 700, winner: true },
  ],
  ...over,
});

// 20 House seats, 2 Senate, 2 Governor and 2 measures: 26 races, keyed by the civicAPI type search that lists them.
const FULL: Record<string, ReturnType<typeof race>[]> = {
  "House of Representatives": Array.from({ length: 20 }, (_, i) =>
    race(100 + i, "House of Representatives", `Pennsylvania US House ${i + 1}`, { district: `PA-${String(i + 1).padStart(2, "0")}`, election_type: "District" }),
  ),
  "US Senate": [race(1, "US Senate", "Pennsylvania US Senate"), race(2, "US Senate", "Ohio US Senate", { province: "OH" })],
  Governor: [race(10, "Governor", "Pennsylvania Governor"), race(11, "Governor", "Ohio Governor", { province: "OH" })],
  Referendum: [race(20, "Referendum", "Missouri Amendment 8", { province: "MO" }), race(21, "Referendum", "Ohio Issue 1", { province: "OH" })],
};

/** Answers civicAPI's race search from `byType`; types not listed come back empty. */
function serve(byType: Record<string, ReturnType<typeof race>[]>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const type = decodeURIComponent(new URL(url).searchParams.get("type") ?? "");
    return new Response(JSON.stringify({ races: byType[type] ?? [] }));
  });
}

const outage = () => vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));

type Row = { race_id: number; data: string; fetched_at: number };
const rows = async (db: Db) => (await db.prepare("SELECT race_id, data, fetched_at FROM midterm_race_snapshots ORDER BY race_id").all<Row>()).results;
const fetchedAt = async (db: Db, id: number) => (await rows(db)).find((r) => r.race_id === id)?.fetched_at;
const iowa = race(3, "US Senate", "Iowa US Senate", { province: "IA" });
const texas = race(4, "US Senate", "Texas US Senate", { province: "TX", percent_reporting: 12 });
const withSenate = (...extra: ReturnType<typeof race>[]) => ({ ...FULL, "US Senate": [...FULL["US Senate"], ...extra] });
const house = FULL["House of Representatives"];
const shortHouse = { ...FULL, "House of Representatives": house.slice(0, 18) };

/** Fetches `byType` at NOW + `minutes`. */
const at = (minutes: number, byType: typeof FULL, db?: Db, background?: (work: Promise<unknown>) => void) => {
  serve(byType);
  return fetchCatalog(NOW + minutes * MINUTE, [], db, background);
};

/** A test D1 that records each write batch's size. */
function countingDb() {
  const real = testDb();
  const batches: number[] = [];
  const db: Db = { ...real, batch: (statements) => (batches.push(statements.length), real.batch(statements)) };
  return { db, batches };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetCivicMemo();
  (RETIRED_RACE_IDS as Set<number>).clear();
});

describe("fetchCatalog's civicAPI searches", () => {
  it("ask only for Nov 3 races, and only statewide ones for governors and measures", async () => {
    const asked: URLSearchParams[] = [];
    vi.stubGlobal("fetch", async (url: string) => (asked.push(new URL(url).searchParams), new Response(JSON.stringify({ races: [] }))));
    await fetchCatalog(NOW);
    expect(asked.map((p) => p.get("type")).sort()).toEqual(["Ballot Measure", "Governor", "House of Representatives", "Proposition", "Referendum", "US Senate"]);
    for (const params of asked) {
      expect(params.get("startDate")).toBe("2026-11-03");
      expect(params.get("endDate")).toBe("2026-11-03");
      const statewideOnly = !["US Senate", "House of Representatives"].includes(params.get("type")!);
      expect(params.get("election_type")).toBe(statewideOnly ? "Statewide" : null);
    }
  });
});

describe("fetchCatalog during an outage", () => {
  it("serves D1's race snapshots, marked stale, when a fresh isolate starts during an outage", async () => {
    const db = testDb();
    const first = await at(0, FULL, db);
    expect(first).toMatchObject({ stale: false, fetchedAt: NOW });
    expect(await rows(db)).toHaveLength(26);

    resetCivicMemo(); // a new isolate: no memory of the catalog above
    outage();
    const second = await fetchCatalog(NOW + 5 * MINUTE, [], db);
    expect(second).toMatchObject({ stale: true, fetchedAt: NOW });
    expect(second.races).toEqual(expect.arrayContaining(first.races));
    expect(second.races).toHaveLength(26);
  });

  it("marks the warm isolate's last catalog stale", async () => {
    const first = await at(0, FULL);
    outage();
    const second = await fetchCatalog(NOW + 2 * MINUTE);
    expect(second).toMatchObject({ stale: true, fetchedAt: NOW });
    expect(second.races).toEqual(first.races);
  });

  it("still throws when there is nothing stored either", async () => {
    outage();
    await expect(fetchCatalog(NOW, [], testDb())).rejects.toBeInstanceOf(CivicError);
  });
});

describe("fetchCatalog with races civicAPI leaves out", () => {
  it("keeps them, flagged missing with their last numbers, and still counts them", async () => {
    const first = await at(0, FULL);
    const partial = await at(2, { ...shortHouse, Governor: [] });
    expect(partial).toMatchObject({ stale: false, fetchedAt: NOW + 2 * MINUTE });
    expect(partial.races).toHaveLength(26);
    const missing = partial.races.filter((r) => r.missing);
    expect(missing.map((r) => r.id).sort((a, b) => a - b)).toEqual([10, 11, 118, 119]);
    expect(missing).toEqual(first.races.filter((r) => [10, 11, 118, 119].includes(r.id)).map((r) => ({ ...r, missing: true, lastSeen: NOW })));
    expect(partial.races.filter((r) => !r.missing).every((r) => r.missing === undefined && r.lastSeen === undefined)).toBe(true);
    expect(balance(partial.races)).toEqual(balance(first.races));
    expect(balance(partial.races)).not.toEqual(balance(first.races.filter((r) => !missing.some((m) => m.id === r.id))));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("house 2, governor 2"));
  });

  it("keeps a race missing across a fresh isolate and fresh again once civicAPI lists it", async () => {
    const db = testDb();
    await at(0, FULL, db);
    await at(2, shortHouse, db);
    resetCivicMemo();
    const stillOut = await at(4, shortHouse, db);
    expect(stillOut.races.filter((r) => r.missing).map((r) => r.lastSeen)).toEqual([NOW, NOW]);

    const counted = { ...FULL, "House of Representatives": house.map((r) => (r.id === 119 ? { ...r, percent_reporting: 90 } : r)) };
    const back = await at(6, counted, db);
    expect(back.races.some((r) => r.missing)).toBe(false);
    expect(back.races.find((r) => r.id === 119)).toMatchObject({ reporting: 90 });
  });

  it("drops only races on the retired list", async () => {
    await at(0, FULL);
    (RETIRED_RACE_IDS as Set<number>).add(119);
    const next = await at(2, shortHouse);
    expect(next.races).toHaveLength(25);
    expect(next.races.some((r) => r.id === 119)).toBe(false);
    expect(next.races.find((r) => r.id === 118)).toMatchObject({ missing: true });
  });
});

describe("fetchCatalog's D1 writes", () => {
  it("writes at most one batch a minute, of only the races whose numbers changed", async () => {
    const { db, batches } = countingDb();
    await at(0, FULL, db);
    expect(batches).toEqual([52]); // every race, all new: registered and stored
    const moved = { ...FULL, Governor: [{ ...FULL.Governor[0], percent_reporting: 55 }, FULL.Governor[1]] };
    await at(0.75, moved, db);
    expect(batches).toHaveLength(1); // under a minute: held back
    await at(1.5, moved, db);
    expect(batches).toEqual([52, 1]);
    expect(await fetchedAt(db, 10)).toBe(NOW + 1.5 * MINUTE);
    expect(await fetchedAt(db, 11)).toBe(NOW);
    await at(3, moved, db);
    expect(batches).toHaveLength(2); // nothing changed
  });

  it("writes new races right away", async () => {
    const db = testDb();
    await at(0, FULL, db);
    const next = await at(0.75, withSenate(iowa), db);
    expect(next.races).toHaveLength(27);
    expect(await fetchedAt(db, 3)).toBe(NOW + 0.75 * MINUTE);
  });

  it("never moves a race's stored numbers back to an older fetch", async () => {
    const db = testDb();
    await at(5, FULL, db);
    resetCivicMemo();
    await at(1, { ...FULL, Governor: [{ ...FULL.Governor[0], percent_reporting: 5 }, FULL.Governor[1]] }, db);
    expect(await fetchedAt(db, 10)).toBe(NOW + 5 * MINUTE);
  });

  it("keeps both isolates' numbers when two write different new races at once", async () => {
    const db = testDb();
    await at(0, FULL, db);
    // Two isolates, each with its own memory; their writes are held until both have answered, then run one
    // transaction after the other as D1 does (the SQLite stand-in can't interleave them).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let queue: Promise<unknown> = gate;
    const gated: Db = {
      ...db,
      batch: (statements) => {
        const run = queue.then(() => db.batch(statements));
        queue = run.catch(() => {});
        return run;
      },
    };
    vi.resetModules();
    const isolateA = await import("../lib/midterms/civic");
    vi.resetModules();
    const isolateB = await import("../lib/midterms/civic");
    const writes: Promise<unknown>[] = [];
    serve(withSenate(iowa));
    await isolateA.fetchCatalog(NOW + MINUTE, [], gated, (w) => writes.push(w));
    serve(withSenate(texas));
    await isolateB.fetchCatalog(NOW + MINUTE, [], gated, (w) => writes.push(w));
    release();
    await Promise.all(writes);

    expect(await fetchedAt(db, 3)).toBe(NOW + MINUTE);
    expect(await fetchedAt(db, 4)).toBe(NOW + MINUTE);
    // A third isolate that sees neither gets both, with their numbers.
    resetCivicMemo();
    const later = await at(3, FULL, db);
    expect(later.races.find((r) => r.id === 3)).toMatchObject({ title: "Iowa US Senate", missing: true, lastSeen: NOW + MINUTE, total: 1000 });
    expect(later.races.find((r) => r.id === 4)).toMatchObject({ title: "Texas US Senate", missing: true, lastSeen: NOW + MINUTE, reporting: 12 });
  });

  it("hands the writes to `background` instead of waiting on them", async () => {
    const db = testDb();
    const handed: Promise<unknown>[] = [];
    const result = await at(0, FULL, db, (work) => handed.push(work));
    expect(result).toMatchObject({ stale: false, fetchedAt: NOW });
    expect(handed).toHaveLength(1);
    await handed[0];
    expect(await rows(db)).toHaveLength(26);
  });

  it("returns fresh results when the writes fail, and tries again in the next batch", async () => {
    const real = testDb();
    let failing = true;
    const flaky: Db = { ...real, batch: async (statements) => (failing ? Promise.reject(new Error("D1 is read-only")) : real.batch(statements)) };
    const result = await at(0, FULL, flaky);
    expect(result).toMatchObject({ stale: false, fetchedAt: NOW });
    expect(result.races).toHaveLength(26);
    expect(errors).toHaveBeenCalledWith("midterms catalog write failed:", expect.any(Error));
    failing = false;
    await at(1.5, FULL, flaky);
    expect(await rows(real)).toHaveLength(26);
  });

  it("doesn't hold the response for writes that hang when there is no background hook", async () => {
    const real = testDb();
    const hanging: Db = { ...real, batch: () => new Promise<never>(() => {}) };
    const started = Date.now();
    const result = await at(0, FULL, hanging);
    expect(result.stale).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("serves results when D1 can't be read", async () => {
    const real = testDb();
    const unreadable: Db = { ...real, prepare: (sql) => (sql.startsWith("SELECT") ? { ...real.prepare(sql), all: async () => Promise.reject(new Error("D1 down")) } : real.prepare(sql)) };
    const result = await at(0, FULL, unreadable);
    expect(result).toMatchObject({ stale: false, fetchedAt: NOW });
    expect(errors).toHaveBeenCalledWith("midterms race snapshot read failed:", expect.any(Error));
  });
});

describe("fetchCatalog's registry and coverage", () => {
  it("registers every race it sees, once", async () => {
    const db = testDb();
    await at(0, FULL, db);
    await at(2, withSenate(iowa), db);
    const registered = (await db.prepare("SELECT race_id, first_seen FROM midterm_registry").all<{ race_id: number; first_seen: number }>()).results;
    expect(registered).toHaveLength(27);
    expect(registered.find((r) => r.race_id === 3)).toEqual({ race_id: 3, first_seen: NOW + 2 * MINUTE });
    expect(registered.find((r) => r.race_id === 1)).toEqual({ race_id: 1, first_seen: NOW });
  });

  it("serves a race only another isolate saw as missing, with that isolate's numbers", async () => {
    const db = testDb();
    await at(0, FULL, db);
    vi.resetModules();
    const other = await import("../lib/midterms/civic");
    serve(withSenate(iowa));
    await other.fetchCatalog(NOW + 0.5 * MINUTE, [], db);
    // This isolate is warm and never sees Iowa; it learns of it from the registry and D1.
    const next = await at(2, FULL, db);
    expect(next.races.find((r) => r.id === 3)).toMatchObject({ title: "Iowa US Senate", missing: true, lastSeen: NOW + 0.5 * MINUTE, total: 1000 });
    expect(next.coverage.senate).toEqual({ listed: 3, missing: 1, expected: 35 });
  });

  it("serves a registered race nothing has numbers for as a placeholder", async () => {
    const db = testDb();
    await db.prepare("INSERT INTO midterm_registry (race_id, office, state, district, first_seen) VALUES (500, 'house', 'WY', 0, ?)").bind(NOW - MINUTE).run();
    const result = await at(0, FULL, db);
    expect(result.races).toHaveLength(27);
    expect(result.races.find((r) => r.id === 500)).toMatchObject({ office: "house", state: "WY", district: 0, title: "Wyoming US House At-Large", missing: true, lastSeen: NOW - MINUTE, candidates: [] });
    expect(result.coverage.house).toEqual({ listed: 21, missing: 1, expected: 435 });
  });

  it("re-reads the registry at most once a minute", async () => {
    const real = testDb();
    let reads = 0;
    const counting: Db = {
      ...real,
      prepare: (sql) => {
        if (sql.includes("FROM midterm_registry")) reads++;
        return real.prepare(sql);
      },
    };
    await at(0, FULL, counting);
    await at(0.75, FULL, counting);
    expect(reads).toBe(1);
    await at(1.5, FULL, counting);
    expect(reads).toBe(2);
  });

  it("counts listed, missing and expected races per office", async () => {
    await at(0, FULL);
    const { coverage } = await at(2, { ...FULL, "House of Representatives": house.slice(0, 15), Referendum: [] });
    expect(coverage).toEqual({
      senate: { listed: 2, missing: 0, expected: 35 },
      house: { listed: 20, missing: 5, expected: 435 },
      governor: { listed: 2, missing: 0, expected: 36 },
      measure: { listed: 2, missing: 2, expected: null },
    });
  });
});

describe("fetchCatalog serving a recent catalog while it refreshes", () => {
  it("answers from memory at once and refreshes once in the background", async () => {
    const db = testDb();
    await at(0, FULL, db);
    let calls = 0;
    serve(withSenate(iowa));
    const counted = globalThis.fetch;
    vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => (calls++, counted(...args)));
    const work: Promise<unknown>[] = [];
    const later = NOW + MINUTE;
    const [a, b] = await Promise.all([fetchCatalog(later, [], db, (w) => work.push(w), true), fetchCatalog(later, [], db, (w) => work.push(w), true)]);
    // Both get the minute-old catalog without waiting on civicAPI; only one refresh starts.
    expect(a).toMatchObject({ fetchedAt: NOW, stale: false });
    expect(b.races).toHaveLength(26);
    await Promise.all(work);
    const typesAsked = calls;
    expect(typesAsked).toBeGreaterThan(0);
    // The refresh is what the next view sees.
    const next = await fetchCatalog(later + 1000, [], db, (w) => work.push(w), true);
    expect(next).toMatchObject({ fetchedAt: later });
    expect(next.races.some((r) => r.id === 3)).toBe(true);
    expect(calls).toBe(typesAsked);
  });

  it("waits for civicAPI when the catalog is older than SERVE_STALE_MS, or the caller can't refresh later", async () => {
    await at(0, FULL);
    serve(withSenate(iowa));
    expect(await fetchCatalog(NOW + 5 * MINUTE, [], undefined, () => {}, true)).toMatchObject({ fetchedAt: NOW + 5 * MINUTE });
    serve(withSenate(iowa, texas));
    expect(await fetchCatalog(NOW + 6 * MINUTE, [], undefined, undefined, true)).toMatchObject({ fetchedAt: NOW + 6 * MINUTE });
  });

  it("serves a fresh isolate D1's recent snapshots, then refreshes", async () => {
    const db = testDb();
    await at(0, FULL, db);
    resetCivicMemo();
    serve(withSenate(iowa));
    const work: Promise<unknown>[] = [];
    const first = await fetchCatalog(NOW + MINUTE, [], db, (w) => work.push(w), true);
    expect(first).toMatchObject({ fetchedAt: NOW, stale: false });
    expect(first.races).toHaveLength(26);
    await Promise.all(work);
    expect((await fetchCatalog(NOW + MINUTE + 1000, [], db)).races).toHaveLength(27);
  });

  it("serves a fresh isolate D1's copy at once after a recent refresh that changed no numbers", async () => {
    const db = testDb();
    await at(0, FULL, db);
    await at(2, FULL, db);
    expect(await fetchedAt(db, 1)).toBe(NOW); // unchanged, so not rewritten
    resetCivicMemo();
    outage();
    const work: Promise<unknown>[] = [];
    const first = await fetchCatalog(NOW + 3 * MINUTE, [], db, (w) => work.push(w), true);
    expect(first).toMatchObject({ fetchedAt: NOW + 2 * MINUTE, stale: false });
    expect(first.races).toHaveLength(26);
    await Promise.all(work);
  });

  it("doesn't count a refresh that missed a race type as recent", async () => {
    const db = testDb();
    await at(0, FULL, db);
    vi.stubGlobal("fetch", async (url: string) => {
      const type = decodeURIComponent(new URL(url).searchParams.get("type") ?? "");
      return type === "Governor" ? new Response("down", { status: 503 }) : new Response(JSON.stringify({ races: FULL[type] ?? [] }));
    });
    await fetchCatalog(NOW + 2 * MINUTE, [], db);
    resetCivicMemo();
    outage();
    expect(await fetchCatalog(NOW + 4 * MINUTE, [], db, () => {}, true)).toMatchObject({ fetchedAt: NOW, stale: true });
  });

  it("still stores races when the refresh time can't be written", async () => {
    const db = testDb();
    await db.prepare("DROP TABLE midterm_catalog_refresh").run();
    await at(0, FULL, db);
    expect(await rows(db)).toHaveLength(26);
    resetCivicMemo();
    outage();
    expect(await fetchCatalog(NOW + MINUTE, [], db, () => {}, true)).toMatchObject({ fetchedAt: NOW, stale: false });
  });
});
