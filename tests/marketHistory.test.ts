import { describe, expect, it } from "vitest";
import { kalshiEvents, kalshiOutcomes, parseKalshiCandles, parsePolyHistory, polyOutcomes, question, thin, type KalshiMarket, type PolyEvent } from "../lib/midterms/marketHistory";

const race = (over: Partial<Parameters<typeof question>[0]> = {}) => ({
  id: 1,
  office: "senate" as const,
  state: "CO",
  district: null,
  title: "Colorado US Senate",
  candidates: [
    { name: "John Hickenlooper", party: "Democratic", votes: 0, pct: 0, winner: false, incumbent: true },
    { name: "Mark Baisley", party: "Republican", votes: 0, pct: 0, winner: false, incumbent: false },
  ],
  ...over,
});

describe("market panel data", () => {
  it("asks the race's question", () => {
    expect(question(race())).toBe("Who wins the Colorado Senate race?");
    expect(question(race({ office: "governor", state: "CA" }))).toBe("Who wins the California governor's race?");
    expect(question(race({ office: "house", state: "PA", district: 7 }))).toBe("Who wins the PA-07 House race?");
  });

  it("reads Polymarket outcomes, skipping placeholders, and names party-only labels by the race's candidate", () => {
    // Shaped like gamma-api's "Colorado Senate Election Winner" event.
    const event: PolyEvent = {
      slug: "colorado-senate-election-winner",
      title: "Colorado Senate Election Winner",
      markets: [
        { groupItemTitle: "Mark Baisley (R)", outcomePrices: '["0.013", "0.987"]', clobTokenIds: '["tokR", "noR"]', active: true, closed: false },
        { groupItemTitle: "Democrat", question: "Will the Democrats win the Colorado Senate race in 2026?", outcomePrices: '["0.9885", "0.0115"]', clobTokenIds: '["tokD", "noD"]', active: true },
        { groupItemTitle: "Person A", clobTokenIds: '["tokA", "noA"]', active: false },
      ],
    };
    expect(polyOutcomes(event, race())).toEqual([
      { name: "John Hickenlooper", side: "D", now: 0.989, id: "tokD" },
      { name: "Mark Baisley", side: "R", now: 0.013, id: "tokR" },
    ]);
  });

  it("takes a name-only outcome's party from the race's candidates", () => {
    // California's governor event labels outcomes by name alone.
    const event: PolyEvent = { markets: [{ groupItemTitle: "John Hickenlooper", outcomePrices: '["0.97","0.03"]', clobTokenIds: '["a","b"]' }, { groupItemTitle: "Rick Caruso", outcomePrices: '["0.001","0.999"]', clobTokenIds: '["c","d"]' }] };
    expect(polyOutcomes(event, race()).map((o) => [o.name, o.side])).toEqual([
      ["John Hickenlooper", "D"],
      ["Rick Caruso", null],
    ]);
  });

  it("thins a long history to evenly spread points, keeping the first and latest", () => {
    const points = Array.from({ length: 1000 }, (_, i): [number, number] => [i, i / 1000]);
    const kept = thin(points, 10);
    expect(kept).toHaveLength(10);
    expect(kept[0]).toEqual([0, 0]);
    expect(kept.at(-1)).toEqual([999, 0.999]);
    expect(thin(points.slice(0, 5), 10)).toHaveLength(5);
  });

  it("turns Polymarket price history into points", () => {
    expect(parsePolyHistory({ history: [{ t: 1760400010, p: 0.5 }, { t: 1760486417, p: 0.91547 }, { t: null, p: 0.2 }] })).toEqual([
      [1760400010, 0.5],
      [1760486417, 0.915],
    ]);
    expect(parsePolyHistory({ error: "invalid market" })).toEqual([]);
  });

  it("lists the Kalshi events a race could trade under", () => {
    expect(kalshiEvents(race())).toEqual(["SENATECO-26"]);
    expect(kalshiEvents(race({ title: "Ohio US Senate (special)", state: "OH" }))).toEqual(["SENATEOHS-26"]);
    expect(kalshiEvents(race({ office: "house", state: "MN", district: 5 }))).toEqual(["KXHOUSERACE-MN05-26", "HOUSEMN5-26", "KXHOUSEMN5-26"]);
    expect(kalshiEvents(race({ office: "house", state: "WY", district: 0 }))).toEqual(["KXHOUSERACE-WYAL-26", "HOUSEWYAL-26", "KXHOUSEWYAL-26"]);
  });

  it("reads Kalshi outcomes by ticker suffix, including candidate-coded independents", () => {
    // Shaped like /markets?event_ticker=KXHOUSERACE-MN05-26.
    const markets: KalshiMarket[] = [
      { ticker: "KXHOUSERACE-MN05-26-R", status: "active", yes_sub_title: "John Nagel", subtitle: "Republican party:: Republican party", last_price_dollars: "0.0340" },
      { ticker: "KXHOUSERACE-MN05-26-DJAC", status: "active", yes_sub_title: "DeVelle Jackson", subtitle: ":: Independent", last_price_dollars: "0.0100" },
      { ticker: "KXHOUSERACE-MN05-26-D", status: "active", yes_sub_title: "Ilhan Omar", subtitle: "Democratic party:: Democratic (DFL) party", last_price_dollars: "0.9690" },
      { ticker: "KXHOUSERACE-MN05-26-X", status: "settled", yes_sub_title: "Gone" },
    ];
    expect(kalshiOutcomes(markets, race()).map((o) => [o.name, o.side, o.now])).toEqual([
      ["Ilhan Omar", "D", 0.969],
      ["John Nagel", "R", 0.034],
      ["DeVelle Jackson", "I", 0.01],
    ]);
  });

  it("prices Kalshi candles by last trade, else a tight book, else the previous trade", () => {
    const body = {
      candlesticks: [
        // No trade and a wide book: nothing usable.
        { end_period_ts: 1733288400, price: {}, yes_bid: { close_dollars: "0.3700" }, yes_ask: { close_dollars: "0.9500" } },
        { end_period_ts: 1733374800, price: {}, yes_bid: { close_dollars: "0.9100" }, yes_ask: { close_dollars: "0.9500" } },
        { end_period_ts: 1793246400, price: { close_dollars: "0.9850", previous_dollars: "0.9850" } },
        { end_period_ts: 1793250000, price: { previous_dollars: "0.9840" }, yes_bid: { close_dollars: "0.5" }, yes_ask: { close_dollars: "0.99" } },
      ],
    };
    expect(parseKalshiCandles(body)).toEqual([
      [1733374800, 0.93],
      [1793246400, 0.985],
      [1793250000, 0.984],
    ]);
    expect(parseKalshiCandles(null)).toEqual([]);
  });
});
