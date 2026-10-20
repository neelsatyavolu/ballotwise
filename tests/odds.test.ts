import { afterEach, describe, expect, it, vi } from "vitest";
import { combineMarkets, evidenceAt, kalshiRace, kalshiTickers, parseKalshi, parsePolymarket, pollAverages, rate, ratedRaces, readOdds, refreshOdds } from "../lib/midterms/odds";
import { summarize, type RaceSummary } from "../lib/midterms/races";
import { testDb } from "./sqlite-db";

const NOW = Date.parse("2026-10-20T12:00:00Z");

const race = (over: Record<string, unknown>): RaceSummary =>
  summarize(
    {
      id: 1,
      type: "US Senate",
      province: "GA",
      district: null,
      election_name: "Georgia US Senate",
      election_type: "Statewide",
      election_date: "2026-11-03T05:00:00.000Z",
      percent_reporting: 0,
      candidates: [
        { name: "Jon Ossoff", party: "Democratic", votes: 0 },
        { name: "Mike Collins", party: "Republican", votes: 0 },
      ],
      ...over,
    },
    [],
  )!;

const kalshi = (ticker: string, bid: number, ask: number, extra: Record<string, unknown> = {}) => ({
  ticker,
  event_ticker: ticker.replace(/-[DRI]$/, ""),
  yes_bid_dollars: String(bid),
  yes_ask_dollars: String(ask),
  last_price_dollars: String((bid + ask) / 2),
  volume_fp: "100",
  status: "active",
  ...extra,
});

describe("rate", () => {
  it("rates by the favorite's market chance, with polls as the fallback", () => {
    expect(rate({ odds: { D: 0.55, R: 0.45 }, sources: ["Kalshi"] }, null)).toBe("tossup");
    expect(rate({ odds: { D: 0.3, R: 0.7 }, sources: ["Kalshi"] }, null)).toBe("lean-r");
    expect(rate({ odds: { D: 0.8, R: 0.2 }, sources: ["Kalshi"] }, null)).toBe("likely-d");
    expect(rate({ odds: { D: 0.95, R: 0.05 }, sources: ["Kalshi"] }, null)).toBeNull();
    expect(rate({ odds: { R: 0.3, I: 0.7 }, sources: ["Polymarket"] }, null)).toBe("lean-i");
    // Markets win over polls when both exist.
    expect(rate({ odds: { D: 0.95, R: 0.05 }, sources: ["Kalshi"] }, { margin: 1, count: 3, latest: "2026-10-10" })).toBeNull();
    expect(rate(null, { margin: -2.4, count: 3, latest: "2026-10-10" })).toBe("tossup");
    expect(rate(null, { margin: 4, count: 3, latest: "2026-10-10" })).toBe("lean-d");
    expect(rate(null, { margin: -8, count: 3, latest: "2026-10-10" })).toBe("likely-r");
    expect(rate(null, { margin: 14, count: 3, latest: "2026-10-10" })).toBeNull();
    expect(rate(null, null)).toBeNull();
  });
});

describe("Kalshi", () => {
  it("reads the race and party from every 2026 ticker pattern", () => {
    expect(kalshiRace("SENATEGA-26-D")).toEqual({ key: "senate:GA:", side: "D" });
    expect(kalshiRace("SENATEOHS-26-R")).toEqual({ key: "senate:OH:", side: "R" });
    expect(kalshiRace("GOVPARTYPA-26-D")).toEqual({ key: "governor:PA:", side: "D" });
    expect(kalshiRace("KXGOVPARTYFL-26-R")).toEqual({ key: "governor:FL:", side: "R" });
    expect(kalshiRace("KXHOUSERACE-AL01-26-R")).toEqual({ key: "house:AL:1", side: "R" });
    expect(kalshiRace("KXHOUSERACE-DEAL-26-D")).toEqual({ key: "house:DE:0", side: "D" });
    expect(kalshiRace("HOUSEPA7-26-D")).toEqual({ key: "house:PA:7", side: "D" });
    expect(kalshiRace("KXHOUSETX35-26-R")).toEqual({ key: "house:TX:35", side: "R" });
    expect(kalshiRace("SENATEGA-28-D")).toBeNull();
    expect(kalshiRace("KXHOUSERACE-IL09-26-KKIL")).toBeNull();
  });

  it("uses the book's midpoint, normalizes to 100%, and keeps the busier market when a race is listed twice", () => {
    const odds = parseKalshi([
      kalshi("SENATEGA-26-D", 0.95, 0.96),
      kalshi("SENATEGA-26-R", 0.04, 0.05),
      // Wide book: falls back to the last trade.
      kalshi("HOUSEPA7-26-D", 0.1, 0.9, { last_price_dollars: "0.6" }),
      kalshi("HOUSEPA7-26-R", 0.38, 0.42),
      kalshi("KXHOUSERACE-PA07-26-D", 0.2, 0.22, { volume_fp: "5" }),
      kalshi("KXHOUSERACE-PA07-26-R", 0.78, 0.8, { volume_fp: "5" }),
    ]);
    expect(odds.get("senate:GA:")!.D).toBeCloseTo(0.955, 3);
    expect(odds.get("house:PA:7")!.D).toBeCloseTo(0.6, 3);
  });

  it("gives an unlisted independent the share the listed parties leave over", () => {
    // Nebraska: Kalshi lists only D and R; the independent's chance is what's left.
    const ne = parseKalshi([kalshi("SENATENE-26-R", 0.73, 0.74), kalshi("SENATENE-26-D", 0, 0.001, { last_price_dollars: "0.001" })], new Set(["senate:NE:"])).get("senate:NE:")!;
    expect(ne.R).toBeCloseTo(0.735, 2);
    expect(ne.I).toBeCloseTo(0.264, 2);
    expect(rate({ odds: ne, sources: ["Kalshi"] }, null)).toBe("lean-r");
  });

  it("gives an unpriced major party the remainder, and only invents an independent where one runs", () => {
    const onlyD = [kalshi("HOUSEPA7-26-D", 0.34, 0.36), kalshi("HOUSEPA7-26-R", 0, 0, { last_price_dollars: "0" })];
    expect(parseKalshi(onlyD).get("house:PA:7")).toEqual({ D: expect.closeTo(0.35, 3), R: expect.closeTo(0.65, 3) });
    expect(parseKalshi(onlyD, new Set(["house:PA:7"])).get("house:PA:7")!.I).toBeUndefined();
    // Both majors priced but short of 1 and no independent running: just rescale.
    const short = parseKalshi([kalshi("SENATEGA-26-D", 0.5, 0.5), kalshi("SENATEGA-26-R", 0.3, 0.3)]).get("senate:GA:")!;
    expect(short).toEqual({ D: expect.closeTo(0.625, 3), R: expect.closeTo(0.375, 3) });
  });

  it("asks for Senate, Governor and uncovered House tickers only", () => {
    const tickers = kalshiTickers(
      [race({}), race({ id: 2, type: "Governor", election_name: "Pennsylvania Governor", province: "PA" }), race({ id: 3, type: "House of Representatives", election_name: "Pennsylvania US House 7", province: "PA", district: "PA-07" }), race({ id: 4, type: "House of Representatives", election_name: "Pennsylvania US House 8", province: "PA", district: "PA-08" })],
      new Set(["house:PA:8"]),
    );
    expect(tickers).toContain("SENATEGA-26-D");
    expect(tickers).toContain("KXGOVPARTYPA-26-R");
    expect(tickers).toContain("HOUSEPA7-26-D");
    expect(tickers.some((t) => t.includes("PA8"))).toBe(false);
  });
});

describe("Polymarket", () => {
  it("reads state and party from Senate and Governor winner events, skipping placeholders", () => {
    const odds = parsePolymarket([
      {
        title: "Nebraska Senate Election Winner",
        markets: [
          { groupItemTitle: "Pete Ricketts (R)", outcomePrices: '["0.6","0.4"]', active: true },
          { groupItemTitle: "Dan Osborn (I)", outcomePrices: '["0.4","0.6"]', active: true },
          { groupItemTitle: "Other", active: false },
        ],
      },
      { title: "New Hampshire Governor Election Winner", markets: [{ question: "Will the Democrats win?", outcomePrices: '["0.3","0.7"]' }, { question: "Will the Republicans win?", outcomePrices: '["0.7","0.3"]' }] },
      { title: "Which party will win the Senate in 2026?", markets: [] },
    ]);
    expect(odds.get("senate:NE:")).toEqual({ R: 0.6, I: 0.4 });
    expect(odds.get("governor:NH:")).toEqual({ D: 0.3, R: 0.7 });
    expect(odds.size).toBe(2);
  });

  it("averages markets across both sources and names them", () => {
    const merged = combineMarkets(new Map([["senate:GA:", { D: 0.9, R: 0.1 }]]), new Map([["senate:GA:", { D: 0.8, R: 0.2 }], ["senate:NE:", { R: 0.6, I: 0.4 }]]));
    expect(merged.get("senate:GA:")).toEqual({ odds: { D: 0.85, R: 0.15 }, sources: ["Kalshi", "Polymarket"] });
    expect(merged.get("senate:NE:")!.sources).toEqual(["Polymarket"]);
  });
});

describe("polls", () => {
  const races = [race({}), race({ id: 5, type: "House of Representatives", election_name: "Pennsylvania US House 7", province: "PA", district: "PA-07", candidates: [{ name: "Bob Brooks", party: "Democratic" }, { name: "Ryan Mackenzie", party: "Republican" }] })];
  const poll = (over: Record<string, unknown>) => ({ subject: "2026 Georgia", pollster: "A", end_date: "2026-10-10", answers: [{ choice: "Ossoff", pct: 50 }, { choice: "Collins", pct: 44 }], ...over });

  it("averages each pollster's newest nonpartisan general-election poll from the last 45 days", () => {
    const avg = pollAverages(
      [
        poll({}),
        poll({ end_date: "2026-09-30", answers: [{ choice: "Jon Ossoff", pct: 40 }, { choice: "Mike Collins", pct: 50 }] }), // older, same pollster
        poll({ pollster: "B", answers: [{ choice: "Jon Ossoff", pct: 48 }, { choice: "Mike Collins", pct: 46 }] }),
        poll({ pollster: "C", partisan: "REP", answers: [{ choice: "Ossoff", pct: 40 }, { choice: "Collins", pct: 55 }] }),
        poll({ pollster: "D", end_date: "2026-07-01" }),
        poll({ pollster: "E", end_date: "2026-10-27" }), // ends in the future
        poll({ pollster: "F", subject: "2026 Georgia Republican" }), // a primary
      ],
      "senate",
      races,
      NOW,
    );
    expect(avg.get("senate:GA:")).toEqual({ margin: 4, count: 2, latest: "2026-10-10" });
  });

  it("matches House polls by seat", () => {
    const avg = pollAverages([{ subject: "2026 PA-07", seat_name: "PA-07", pollster: "X", end_date: "2026-10-01", answers: [{ choice: "Brooks", pct: 47 }, { choice: "Mackenzie", pct: 45 }] }], "house", races, NOW);
    expect(avg.get("house:PA:7")!.margin).toBe(2);
  });
});

describe("refreshOdds", () => {
  afterEach(() => vi.unstubAllGlobals());
  const races = [race({}), race({ id: 2, province: "NE", election_name: "Nebraska US Senate", candidates: [{ name: "Pete Ricketts", party: "Republican" }, { name: "Dan Osborn", party: "Independent" }] })];

  function stub(fail: string[] = []) {
    vi.stubGlobal("fetch", async (url: string) => {
      const host = new URL(url).hostname;
      if (fail.some((f) => host.includes(f))) return new Response("down", { status: 503 });
      if (host.includes("kalshi")) return Response.json({ markets: url.includes("tickers=") ? [kalshi("SENATEGA-26-D", 0.55, 0.57), kalshi("SENATEGA-26-R", 0.43, 0.45)] : [] });
      if (host.includes("polymarket")) return Response.json(url.includes("senate") ? [{ title: "Nebraska Senate Election Winner", markets: [{ groupItemTitle: "Pete Ricketts (R)", outcomePrices: '["0.7","0.3"]' }, { groupItemTitle: "Dan Osborn (I)", outcomePrices: '["0.3","0.7"]' }] }] : []);
      if (host.includes("votehub")) return Response.json(url.includes("us-senator") ? [{ subject: "2026 Georgia", pollster: "A", end_date: "2026-10-10", answers: [{ choice: "Ossoff", pct: 49 }, { choice: "Collins", pct: 47 }] }] : []);
      return new Response("?", { status: 404 });
    });
  }

  it("saves ratings from markets and polls, read back as rated races", async () => {
    const db = testDb();
    stub();
    const snap = await refreshOdds(db, races, NOW);
    expect(snap.signals["senate:GA:"]).toMatchObject({ rating: "tossup", polls: { margin: 2 } });
    expect(snap.signals["senate:NE:"].rating).toBe("lean-r");
    expect(ratedRaces(await readOdds(db, NOW))).toEqual(
      expect.arrayContaining([
        { office: "senate", state: "GA", district: null, rating: "tossup" },
        { office: "senate", state: "NE", district: null, rating: "lean-r" },
      ]),
    );
  });

  it("keeps Kalshi's last prices when only Kalshi is down, and drops prices hours old", async () => {
    const db = testDb();
    stub();
    await refreshOdds(db, races, NOW);
    stub(["kalshi"]);
    const soon = await refreshOdds(db, races, NOW + 10 * 60 * 1000);
    expect(soon.signals["senate:GA:"].market?.sources).toEqual(["Kalshi"]);
    expect(soon.kalshi?.at).toBe(NOW);
    const hoursLater = await refreshOdds(db, races, NOW + 4 * 60 * 60 * 1000);
    expect(hoursLater.kalshi).toBeNull();
    expect(hoursLater.signals["senate:GA:"].market).toBeNull();
    expect(evidenceAt(hoursLater)).toBe(NOW + 4 * 60 * 60 * 1000);
  });

  it("waits out a Kalshi rate limit and retries", async () => {
    const db = testDb();
    let limited = 1;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("kalshi") && url.includes("tickers=") && limited-- > 0) return new Response("slow down", { status: 429 });
      if (url.includes("kalshi")) return Response.json({ markets: url.includes("tickers=") ? [kalshi("SENATEGA-26-D", 0.55, 0.57), kalshi("SENATEGA-26-R", 0.43, 0.45)] : [] });
      return Response.json([]);
    });
    const snap = await refreshOdds(db, races, NOW);
    expect(snap.signals["senate:GA:"].market?.sources).toEqual(["Kalshi"]);
  }, 15_000);

  it("never lets an older run overwrite a newer snapshot", async () => {
    const db = testDb();
    stub();
    await refreshOdds(db, races, NOW + 1000);
    await refreshOdds(db, races, NOW);
    expect((await readOdds(db, NOW + 2000))?.at).toBe(NOW + 1000);
  });

  it("keeps the last good markets and polls when every source is down", async () => {
    const db = testDb();
    stub();
    await refreshOdds(db, races, NOW);
    stub(["kalshi", "polymarket", "votehub"]);
    const later = await refreshOdds(db, races, NOW + 60 * 60 * 1000);
    expect(later.signals["senate:GA:"]).toMatchObject({ rating: "tossup", polls: { margin: 2 } });
    expect(later.signals["senate:NE:"].market?.sources).toEqual(["Polymarket"]);
  });
});
