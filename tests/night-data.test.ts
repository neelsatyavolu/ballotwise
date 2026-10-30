import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withCall } from "../lib/midterms/catalog";
import { fetchCatalog, resetCivicMemo } from "../lib/midterms/civic";
import { liveJson, matches } from "../lib/midterms/etag";
import { DEFAULT_FILTERS, explore } from "../lib/midterms/explore";
import { leadingFlip } from "../lib/midterms/holders";
import { ELECTION_POLL_MS, fetchLive, isLagging, LAG_MS, LiveError, MAX_BACKOFF_MS, POLL_MS, pollInterval, retryDelay } from "../lib/midterms/live";
import { ELECTION_DAY_START, filedAt, stateCloses, stateFinal } from "../lib/midterms/polls";
import { raceDetail, summarize, type RaceSummary } from "../lib/midterms/races";
import { simulateOverview, simulatePayload } from "../lib/midterms/sim";
import { leading, type Overview } from "../lib/midterms/view";

const HOUR = 3_600_000;

const raw = (over: Record<string, unknown> = {}) => ({
  id: 1,
  type: "US Senate",
  country: "US",
  province: "GA",
  district: null,
  election_name: "Georgia US Senate",
  election_type: "Statewide",
  election_date: "2026-11-03T05:00:00.000Z",
  percent_reporting: 40,
  candidates: [
    { name: "Ann Lee", party: "Republican", votes: 300, winner: false },
    { name: "Bo Diaz", party: "Democratic", votes: 700, winner: false },
  ],
  ...over,
});

/** A counted race: `dem` and `rep` votes, `reporting` percent in, called for `winner` when given. */
function counted(id: number, state: string, dem: number, rep: number, reporting: number, winner: "D" | "R" | null = null): RaceSummary {
  const total = dem + rep;
  return {
    id,
    office: "senate",
    state,
    district: null,
    title: `${state} US Senate`,
    reporting,
    total,
    rating: null,
    candidates: [
      { name: "Dee", party: "Democratic", votes: dem, pct: (dem / total) * 100, winner: winner === "D", incumbent: false },
      { name: "Rex", party: "Republican", votes: rep, pct: (rep / total) * 100, winner: winner === "R", incumbent: false },
    ].sort((a, b) => b.votes - a.votes),
  };
}

describe("polling", () => {
  it("speeds up from election day on, re-read at each poll", () => {
    expect(pollInterval(ELECTION_DAY_START - 1)).toBe(POLL_MS);
    expect(pollInterval(ELECTION_DAY_START)).toBe(ELECTION_POLL_MS);
  });

  it("backs off after failures, up to a cap", () => {
    expect(retryDelay(15_000, 1)).toBe(30_000);
    expect(retryDelay(15_000, 2)).toBe(60_000);
    expect(retryDelay(15_000, 9)).toBe(MAX_BACKOFF_MS);
  });

  it("flags results more than LAG_MS behind", () => {
    expect(isLagging(1000, 1000 + LAG_MS)).toBe(false);
    expect(isLagging(1000, 1001 + LAG_MS)).toBe(true);
    expect(isLagging(null, 1e12)).toBe(false);
  });

  describe("fetchLive", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("sends the held ETag and reads a 304 as unchanged, with the server's fetch time", async () => {
      const seen: (string | null)[] = [];
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        seen.push(new Headers(init.headers).get("if-none-match"));
        return new Response(null, { status: 304, headers: { etag: 'W/"a"', "x-fetched-at": "5000" } });
      });
      expect(await fetchLive("/api/midterms", 'W/"a"', new AbortController().signal)).toEqual({ same: true, etag: 'W/"a"', fetchedAt: 5000 });
      expect(seen).toEqual(['W/"a"']);
    });

    it("always asks the server, never a browser-cached copy that may be up to max-age behind", async () => {
      const modes: (RequestCache | undefined)[] = [];
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        modes.push(init.cache);
        return new Response(null, { status: 304, headers: { etag: 'W/"a"' } });
      });
      await fetchLive("/x", 'W/"a"', new AbortController().signal);
      await fetchLive("/x", null, new AbortController().signal);
      expect(modes).toEqual(["no-cache", "no-cache"]);
    });

    it("reads a 200 with the held ETag as unchanged, and a new one as data", async () => {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ fetchedAt: 7 }), { headers: { etag: 'W/"b"' } }));
      expect(await fetchLive("/x", 'W/"b"', new AbortController().signal)).toMatchObject({ same: true, fetchedAt: 7 });
      expect(await fetchLive("/x", 'W/"a"', new AbortController().signal)).toEqual({ same: false, data: { fetchedAt: 7 }, etag: 'W/"b"', fetchedAt: 7 });
    });

    it("gives up an aborted request and carries the server's error message", async () => {
      vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))));
      const controller = new AbortController();
      const pending = fetchLive("/x", null, controller.signal);
      controller.abort();
      await expect(pending).rejects.toThrow("taking too long");
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Live results are unavailable" }), { status: 503 }));
      await expect(fetchLive("/x", null, new AbortController().signal)).rejects.toEqual(new LiveError("Live results are unavailable", 503));
    });
  });
});

describe("ETags on live routes", () => {
  it("answers 304 for unchanged content even when the fetch time moved, and 200 once it changes", async () => {
    const first = await liveJson(new Request("http://x/"), { fetchedAt: 1, races: [1, 2] });
    const etag = first.headers.get("etag")!;
    expect(await first.json()).toEqual({ fetchedAt: 1, races: [1, 2] });
    const same = await liveJson(new Request("http://x/", { headers: { "if-none-match": etag } }), { fetchedAt: 2, races: [1, 2] });
    expect(same.status).toBe(304);
    expect(same.headers.get("x-fetched-at")).toBe("2");
    expect(await same.text()).toBe("");
    const moved = await liveJson(new Request("http://x/", { headers: { "if-none-match": etag } }), { fetchedAt: 3, races: [1, 3] });
    expect(moved.status).toBe(200);
    expect(moved.headers.get("etag")).not.toBe(etag);
  });

  it("matches weak and strong forms and lists", () => {
    expect(matches('"abc"', 'W/"abc"')).toBe(true);
    expect(matches('W/"x", W/"abc"', 'W/"abc"')).toBe(true);
    expect(matches('W/"x"', 'W/"abc"')).toBe(false);
    expect(matches(null, 'W/"abc"')).toBe(false);
  });
});

describe("reading civicAPI answers", () => {
  const unopposed = raw({ candidates: [{ name: "Solo Run", party: "Democratic", votes: 0, winner: true }] });

  it("trusts an unopposed candidate's call only once the state's polls have closed", () => {
    const closes = stateFinal("GA")!;
    expect(summarize(unopposed, [], closes - 1)!.candidates[0].winner).toBe(false);
    expect(summarize(unopposed, [], closes)!.candidates[0].winner).toBe(true);
  });

  it("marks an answer that leaves out who won, rather than reading it as uncalled", () => {
    expect(summarize(raw(), [])).not.toHaveProperty("callUnknown");
    expect(summarize(raw({ candidates: [{ name: "Ann Lee", party: "Republican", votes: 300 }] }), [])).toMatchObject({ callUnknown: true });
    expect(summarize(raw({ candidates: [] }), [])).toMatchObject({ callUnknown: true });
  });

  it("marks ranked-choice races and keeps civicAPI's round", () => {
    expect(summarize(raw({ province: "AK", round: 2 }), [])).toMatchObject({ rcv: true, round: 2 });
    expect(summarize(raw({ province: "ME" }), [])).toMatchObject({ rcv: true });
    expect(summarize(raw({ type: "Governor", province: "ME", election_name: "Maine Governor" }), [])).not.toHaveProperty("rcv");
    expect(summarize(raw(), [])).not.toHaveProperty("rcv");
  });

  it("keeps a county's missing reporting figure unknown, and works the detail's out from its own answer", () => {
    const summary = { ...summarize(raw({ percent_reporting: null }), [])!, callUnknown: true as const };
    expect(summary.reportingUnknown).toBe(true);
    const region = (percent: number | null) => ({ name: "Fulton", fips: "13121", percent_reporting: percent, candidates: [{ name: "Bo Diaz", party: "Democratic", votes: 10, winner: false }] });
    const detail = raceDetail(summary, raw({ percent_reporting: 55, region_results: { a: region(null), b: region(30) } }), {});
    expect(detail).toMatchObject({ reporting: 55 });
    expect(detail.reportingUnknown).toBeUndefined();
    expect(detail.callUnknown).toBeUndefined();
    expect(detail.counties[0]).toMatchObject({ reporting: 0, reportingUnknown: true });
    expect(detail.counties[1]).not.toHaveProperty("reportingUnknown");
    // A detail with no figure borrows the catalog's, unless that was unknown too.
    expect(raceDetail({ ...summary, reportingUnknown: undefined, reporting: 20 }, raw({ percent_reporting: null }), {})).toMatchObject({ reporting: 20 });
    expect(raceDetail(summary, raw({ percent_reporting: null }), {})).toMatchObject({ reportingUnknown: true });
  });
});

describe("calls on the map", () => {
  const call = { id: 1, at: 0, winner: "Dee", replaced: null, withdrawn: false } as const;

  it("names who a race is called for, only when the call log agrees", () => {
    expect(withCall(counted(1, "GA", 60, 40, 90, "D"), call)).toMatchObject({ calledFor: "Dee" });
    expect(withCall(counted(1, "GA", 60, 40, 90, "R"), call)).toMatchObject({ calledFor: null, callPending: true });
    expect(withCall(counted(1, "GA", 60, 40, 90), null)).toMatchObject({ calledFor: null });
  });

  it("keeps the recorded call for an answer that left out who won", () => {
    const shown = withCall({ ...counted(1, "GA", 60, 40, 90), callUnknown: true }, call);
    expect(shown).toMatchObject({ calledFor: "Dee", call });
    expect(shown.candidates.find((c) => c.winner)?.name).toBe("Dee");
  });
});

describe("early leads", () => {
  const races = [counted(1, "GA", 60, 40, 10), counted(2, "NC", 60, 40, 50), counted(3, "OH", 40, 60, 5), counted(4, "PA", 40, 60, 90, "R")];

  it("tallies leads under EARLY_REPORTING apart from firm ones", () => {
    expect(leading(races, "senate")).toEqual({ D: 1, R: 0, other: 0, early: { D: 1, R: 1, other: 0 } });
  });

  it("doesn't call an early lead a possible flip unless asked", () => {
    // North Carolina's Senate seat is held by a Republican; a Democrat leading there is a possible flip.
    const nc = counted(5, "NC", 60, 40, 10);
    expect(leadingFlip(nc)).toBeNull();
    expect(leadingFlip(nc, true)).toBe("D");
    expect(leadingFlip({ ...nc, reporting: 40 })).toBe("D");
  });
});

describe("poll-closing waves", () => {
  it("files a race under its state's first closing, marking split states partial", () => {
    const ks = { ...counted(1, "KS", 1, 1, 0), office: "governor" as const };
    const ga = counted(2, "GA", 1, 1, 0);
    expect(filedAt([ks, ga], stateCloses("KS")!)).toEqual([{ race: ks, partial: true }]);
    expect(filedAt([ks, ga], stateFinal("KS")!)).toEqual([]);
    expect(filedAt([ks, ga], stateCloses("GA")!)).toEqual([{ race: ga, partial: false }]);
  });

  it("filters the explorer the same way", () => {
    const ks = { ...counted(1, "KS", 1, 1, 0), office: "governor" as const };
    expect(explore([ks], { ...DEFAULT_FILTERS, office: "all", waves: [stateCloses("KS")!] }, null)).toHaveLength(1);
    expect(explore([ks], { ...DEFAULT_FILTERS, office: "all", waves: [stateFinal("KS")!] }, null)).toHaveLength(0);
  });
});

describe("catalog refresh", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCivicMemo();
  });
  const NOW = Date.parse("2026-11-04T04:00:00Z");
  const house = (id: number, date = "2026-11-03T05:00:00.000Z") => raw({ id, type: "House of Representatives", election_name: `Georgia US House ${id}`, district: `GA-${String(id).padStart(2, "0")}`, election_type: "District", election_date: date });

  it("keeps every race type that answered when one fails, and says which failed", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const type = new URL(url).searchParams.get("type");
      if (type === "Governor") return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ races: type === "US Senate" ? [raw()] : [] }));
    });
    const catalog = await fetchCatalog(NOW);
    expect(catalog.races.map((r) => r.id)).toEqual([1]);
    expect(catalog.partial).toEqual(["Governor"]);
  });

  it("keeps a failed type's races with their last numbers, marked missing so they aren't observed", async () => {
    const governor = raw({ id: 2, type: "Governor", election_name: "Georgia Governor" });
    let down = false;
    vi.stubGlobal("fetch", async (url: string) => {
      const type = new URL(url).searchParams.get("type");
      if (down && type === "Governor") return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ races: type === "US Senate" ? [raw()] : type === "Governor" ? [governor] : [] }));
    });
    await fetchCatalog(NOW);
    down = true;
    const catalog = await fetchCatalog(NOW + 60_000);
    expect(catalog.races.find((r) => r.id === 2)).toMatchObject({ missing: true, lastSeen: NOW, reporting: 40 });
    expect(catalog.races.find((r) => r.id === 1)).not.toHaveProperty("missing");
  });

  it("pages past a mixed page instead of stopping at the first race from another date", async () => {
    const pages = [
      [...Array.from({ length: 499 }, (_, i) => house(i + 1)), house(9000, "2026-12-01T05:00:00.000Z")],
      [house(600), house(9001, "2026-08-04T05:00:00.000Z")],
    ];
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get("type") !== "House of Representatives") return new Response(JSON.stringify({ races: [] }));
      asked.push(u.searchParams.get("offset")!);
      return new Response(JSON.stringify({ races: pages[Number(u.searchParams.get("offset")) / 500] ?? [] }));
    });
    const catalog = await fetchCatalog(NOW);
    expect(asked).toEqual(["0", "500"]);
    expect(catalog.races.some((r) => r.id === 600)).toBe(true);
    expect(catalog.races.some((r) => r.id === 9000)).toBe(false);
  });
});

describe("election-night preview", () => {
  const overview = (races: RaceSummary[]): Overview => ({ races, balance: { senate: {} as never, house: {} as never, governor: {} as never }, fetchedAt: 0, stale: false, ratings: { updatedAt: null } });
  // Georgia's polls close at 7 p.m. Eastern; with a big lead it's called within the hour.
  const georgia = { ...counted(1, "GA", 1, 1, 0), signal: { market: { odds: { D: 0.99 } } } } as unknown as RaceSummary;
  const others = [2, 3, 4].map((id) => ({ ...counted(id, "VA", 1, 1, 0), office: "house" as const, district: id }));

  it("numbers call events in the order they happened", () => {
    const { callEvents = [] } = simulateOverview(overview([georgia, ...others]), ELECTION_DAY_START + 21 * HOUR);
    const oldestFirst = [...callEvents].reverse();
    expect(oldestFirst.map((e) => e.id)).toEqual(oldestFirst.map((_, i) => i + 1));
    expect(oldestFirst.map((e) => e.at)).toEqual([...oldestFirst.map((e) => e.at)].sort((a, b) => a - b));
  });

  it("withdraws one Senate call at 10 p.m. and makes it again at 11", () => {
    const at = (h: number) => simulateOverview(overview([georgia]), ELECTION_DAY_START + h * HOUR);
    expect(at(21.5).races[0]).toMatchObject({ calledFor: expect.any(String), call: { withdrawn: false } });
    const withdrawn = at(22.5);
    expect(withdrawn.races[0]).toMatchObject({ calledFor: null, call: { withdrawn: true, winner: null } });
    expect(withdrawn.races[0].candidates.some((c) => c.winner)).toBe(false);
    expect(withdrawn.callEvents?.map((e) => e.kind)).toEqual(["withdrawal", "call"]);
    const recalled = at(23.5);
    expect(recalled.callEvents?.map((e) => e.kind)).toEqual(["call", "withdrawal", "call"]);
    expect(recalled.races[0].call).toMatchObject({ id: recalled.callEvents![0].id, withdrawn: false });
  });

  it("simulates once, and fills in a race page's counties", () => {
    const sim = simulateOverview(overview([georgia]), ELECTION_DAY_START + 21 * HOUR);
    expect(simulateOverview(sim, ELECTION_DAY_START + 23 * HOUR)).toBe(sim);
    const detail = { ...georgia, pollsClose: null, updated: null, counties: [{ fips: "13121", name: "Fulton", reporting: 0, total: 0, candidates: [], baseline2024: 40, pres2024: { harris: 7, trump: 3, total: 10 } }] };
    const page = simulatePayload("/api/midterms/race/1", { race: detail, fetchedAt: 0 }, ELECTION_DAY_START + 21 * HOUR);
    expect(page.race.counties[0].total).toBeGreaterThan(0);
    expect(page.race.reporting).toBeGreaterThan(0);
  });
});
