import { afterEach, describe, expect, it, vi } from "vitest";
import { combineMarkets, evidenceAt, genericMargin, kalshiRace, kalshiTickers, officePolls, parseKalshi, parsePolymarket, personalOf, ratedRaces, readOdds, refreshOdds } from "../lib/midterms/odds";
import { summarize, type RaceSummary } from "../lib/midterms/races";
import { ratingOf } from "../lib/midterms/forecast";
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
    expect(odds.get("senate:GA:")!.odds.D).toBeCloseTo(0.955, 3);
    expect(odds.get("house:PA:7")!.odds.D).toBeCloseTo(0.6, 3);
  });

  it("gives an unlisted independent the share the listed parties leave over", () => {
    // Nebraska: Kalshi lists only D and R; the independent's chance is what's left.
    const ne = parseKalshi([kalshi("SENATENE-26-R", 0.73, 0.74), kalshi("SENATENE-26-D", 0, 0.001, { last_price_dollars: "0.001" })], new Set(["senate:NE:"])).get("senate:NE:")!.odds;
    expect(ne.R).toBeCloseTo(0.735, 2);
    expect(ne.I).toBeCloseTo(0.264, 2);
  });

  it("gives an unpriced major party the remainder, and only invents an independent where one runs", () => {
    const onlyD = [kalshi("HOUSEPA7-26-D", 0.34, 0.36), kalshi("HOUSEPA7-26-R", 0, 0, { last_price_dollars: "0" })];
    expect(parseKalshi(onlyD).get("house:PA:7")!.odds).toEqual({ D: expect.closeTo(0.35, 3), R: expect.closeTo(0.65, 3) });
    expect(parseKalshi(onlyD, new Set(["house:PA:7"])).get("house:PA:7")!.odds.I).toBeUndefined();
    // Both majors priced but short of 1 and no independent running: just rescale.
    const short = parseKalshi([kalshi("SENATEGA-26-D", 0.5, 0.5), kalshi("SENATEGA-26-R", 0.3, 0.3)]).get("senate:GA:")!.odds;
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
      // Polymarket's own title, trailing spaces and all.
      { title: "Montana Senate Election Winner   ", markets: [{ groupItemTitle: "Steve Daines (R)", outcomePrices: '["0.9","0.1"]' }, { groupItemTitle: "Democrat", outcomePrices: '["0.1","0.9"]' }] },
      { title: "CA-22 House Election Winner", volume: 50, markets: [{ groupItemTitle: "David Valadao (R)", question: "Will the Republican Party win the CA-22 House seat?", outcomePrices: '["0.095","0.905"]' }, { groupItemTitle: "Randy Villegas (D)", outcomePrices: '["0.915","0.085"]' }] },
      { title: "WY-AL House Election Winner", markets: [{ question: "Will the Republican Party win the WY-AL House seat?", outcomePrices: '["0.97","0.03"]' }] },
      { title: "CA-22 Margin of Victory", markets: [{ groupItemTitle: "D by 5+", outcomePrices: '["0.3","0.7"]' }] },
    ]);
    expect(odds.get("senate:NE:")!.odds).toEqual({ R: 0.6, I: 0.4 });
    expect(odds.get("governor:NH:")!.odds).toEqual({ D: 0.3, R: 0.7 });
    expect(odds.get("senate:MT:")!.odds).toEqual({ R: 0.9, D: 0.1 });
    expect(odds.get("house:CA:22")!.odds.D).toBeCloseTo(0.906, 2);
    expect(odds.get("house:WY:0")!.odds).toEqual({ R: expect.closeTo(0.97, 3), D: expect.closeTo(0.03, 3) });
    expect(odds.size).toBe(5);
  });

  it("averages markets across both sources and names them", () => {
    const merged = combineMarkets(new Map([["senate:GA:", { odds: { D: 0.9, R: 0.1 }, volume: 1000 }]]), new Map([["senate:GA:", { odds: { D: 0.8, R: 0.2 }, volume: 1000 }], ["senate:NE:", { odds: { R: 0.6, I: 0.4 }, volume: 5 }]]));
    expect(merged.get("senate:GA:")).toEqual({ odds: { D: 0.85, R: 0.15 }, sources: ["Kalshi", "Polymarket"], volume: 2000 });
    expect(merged.get("senate:NE:")!.sources).toEqual(["Polymarket"]);
  });

  it("leans toward the busier market, by the log of its volume", () => {
    const merged = combineMarkets(new Map([["senate:GA:", { odds: { D: 0.9, R: 0.1 }, volume: 999_990 }]]), new Map([["senate:GA:", { odds: { D: 0.6, R: 0.4 }, volume: 990 }]]));
    // Weights log10(1e6) = 6 and log10(1000) = 3: two thirds Kalshi.
    expect(merged.get("senate:GA:")!.odds.D).toBeCloseTo(0.8, 3);
  });
});

describe("polls", () => {
  const races = [race({}), race({ id: 5, type: "House of Representatives", election_name: "Pennsylvania US House 7", province: "PA", district: "PA-07", candidates: [{ name: "Bob Brooks", party: "Democratic" }, { name: "Ryan Mackenzie", party: "Republican" }] })];
  const poll = (over: Record<string, unknown>) => ({ subject: "2026 Georgia", pollster: "A", start_date: "2026-10-06", end_date: "2026-10-10", sample_size: 800, population: "lv", answers: [{ choice: "Ossoff", pct: 50 }, { choice: "Collins", pct: 44 }], ...over });

  it("counts every disclosed general-election poll, partisan sponsors included, and lists the rest with a reason", () => {
    const ga = officePolls(
      [
        poll({}),
        poll({ pollster: "B", answers: [{ choice: "Jon Ossoff", pct: 48 }, { choice: "Mike Collins", pct: 46 }] }),
        poll({ pollster: "C", partisan: "REP", answers: [{ choice: "Ossoff", pct: 45 }, { choice: "Collins", pct: 47 }] }),
        poll({ pollster: "D", sample_size: null }), // no sample size: listed, not counted
        poll({ pollster: "E", end_date: "2026-10-27" }), // ends in the future: not listed
        poll({ pollster: "F", subject: "2026 Georgia Republican" }), // a primary: another race
      ],
      "senate",
      races,
      NOW,
    ).get("senate:GA:")!;
    expect(ga.average).toMatchObject({ count: 3, latest: "2026-10-10" });
    expect(ga.average!.margin).toBeCloseTo(2, 1);
    expect(ga.rows).toHaveLength(4);
    expect(ga.rows.find((r) => r.pollster === "D")!.excluded).toBe("No sample size disclosed");
    expect(ga.rows.find((r) => r.pollster === "C")!.partisan).toBe("R");
  });

  it("needs two polls for an average, and matches House polls by seat", () => {
    const pa = officePolls([{ subject: "2026 PA-07", seat_name: "PA-07", pollster: "X", start_date: "2026-09-28", end_date: "2026-10-01", sample_size: 400, answers: [{ choice: "Brooks", pct: 47 }, { choice: "Mackenzie", pct: 45 }] }], "house", races, NOW).get("house:PA:7")!;
    expect(pa.average).toBeNull();
    expect(pa.rows[0].margin).toBe(2);
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
      if (host.includes("polymarket")) return Response.json(url.includes("senate") ? [{ title: "Nebraska Senate Election Winner", volume: 2_000_000, markets: [{ groupItemTitle: "Pete Ricketts (R)", outcomePrices: '["0.7","0.3"]' }, { groupItemTitle: "Dan Osborn (I)", outcomePrices: '["0.3","0.7"]' }] }] : []);
      if (host.includes("votehub")) {
        const ga = (pollster: string) => ({ subject: "2026 Georgia", pollster, start_date: "2026-10-06", end_date: "2026-10-10", sample_size: 900, answers: [{ choice: "Ossoff", pct: 49 }, { choice: "Collins", pct: 47 }] });
        return Response.json(url.includes("us-senator") ? [ga("A"), ga("B")] : []);
      }
      return new Response("?", { status: 404 });
    });
  }

  it("saves forecast ratings, read back as rated races", async () => {
    const db = testDb();
    stub();
    const snap = await refreshOdds(db, races, NOW);
    // Ratings follow the saved forecast (their exact level moves with the tuned settings): Ossoff's incumbency makes
    // Georgia lean Democratic on the fitted fundamentals (no generic ballot in this stub); Nebraska's 2024 lean makes
    // Osborn the underdog, with the busy market (30%) keeping him in range.
    expect(snap.signals["senate:GA:"]).toMatchObject({ polls: { margin: 2 } });
    expect(snap.signals["senate:GA:"].rating).toBe(ratingOf(snap.signals["senate:GA:"].forecast!));
    expect(snap.signals["senate:GA:"].rating).toMatch(/-d$/);
    expect(snap.signals["senate:NE:"].rating).toMatch(/-r$/);
    expect(snap.signals["senate:NE:"].forecast?.left).toBe("I");
    expect(ratedRaces(await readOdds(db, NOW))).toEqual(
      expect.arrayContaining([
        { office: "senate", state: "GA", district: null, rating: snap.signals["senate:GA:"].rating },
        { office: "senate", state: "NE", district: null, rating: snap.signals["senate:NE:"].rating },
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
    const snap = await refreshOdds(db, races, NOW);
    stub(["kalshi", "polymarket", "votehub"]);
    const later = await refreshOdds(db, races, NOW + 60 * 60 * 1000);
    expect(later.signals["senate:GA:"]).toMatchObject({ rating: snap.signals["senate:GA:"].rating, polls: { margin: 2 } });
    expect(later.signals["senate:NE:"].market?.sources).toEqual(["Polymarket"]);
  });
});

describe("personalOf", () => {
  it("gives a running incumbent their measured personal vote, and nothing to an open seat", () => {
    const maine = race({ province: "ME", election_name: "Maine US Senate", candidates: [{ name: "Susan Collins", party: "Republican", votes: 0 }, { name: "Troy Jackson", party: "Democratic", votes: 0 }] });
    expect(personalOf(maine)).toBeLessThan(-10);
    const michigan = race({ province: "MI", election_name: "Michigan US Senate", candidates: [{ name: "Haley Stevens", party: "Democratic", votes: 0 }, { name: "Mike Rogers", party: "Republican", votes: 0 }] });
    expect(personalOf(michigan)).toBeNull();
  });
});

describe("genericMargin", () => {
  it("counts our own average in full once it has enough recent polls, else leans on the aggregators", () => {
    expect(genericMargin({ margin: 6, recent: 10 }, { margin: 9 })).toBe(6);
    expect(genericMargin({ margin: 6, recent: 0 }, { margin: 9 })).toBe(9);
    expect(genericMargin(null, { margin: 9 })).toBe(9);
    expect(genericMargin(null, null)).toBeNull();
  });
});
