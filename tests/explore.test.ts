import { describe, expect, it } from "vitest";
import { activeCount, DEFAULT_FILTERS, explore, flipTo, fromQuery, leaderOf, raceFill, safeSide, statusOf, tierOf, toQuery, viewCounts, type Filters } from "../lib/midterms/explore";
import { compareRaces, type RaceSummary } from "../lib/midterms/view";

let nextId = 1;
/** A forecast signal with these odds, as the scheduled refresh would save it. */
const forecast = (odds: Partial<Record<"D" | "R" | "I", number>>) => ({
  market: null,
  polls: null,
  rating: null,
  forecast: { odds, left: "D" as const, names: null, margin: null, lean: null, incumbency: 0, fundamentals: null, environment: null, pollWeight: 0, pollMargin: null, marketWeight: 0, market: null },
});
function race(over: Partial<RaceSummary> & { votes?: [number, number]; winner?: 0 | 1; incumbent?: 0 | 1 } = {}): RaceSummary {
  const [d, r] = over.votes ?? [0, 0];
  const total = d + r;
  const cands = [
    { name: "Dana Dem", party: "Democratic", votes: d, pct: total ? (d / total) * 100 : 0, winner: over.winner === 0, incumbent: over.incumbent === 0 },
    { name: "Rob Rep", party: "Republican", votes: r, pct: total ? (r / total) * 100 : 0, winner: over.winner === 1, incumbent: over.incumbent === 1 },
  ].sort((a, b) => b.votes - a.votes);
  return { id: nextId++, office: "senate", state: "GA", district: null, title: "Georgia US Senate", reporting: total ? 50 : 0, total, candidates: cands, rating: null, signal: null, ...over };
}
const f = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

describe("race classification", () => {
  it("tells awaiting, counting and called apart", () => {
    expect(statusOf(race())).toBe("awaiting");
    expect(statusOf(race({ votes: [10, 9] }))).toBe("counting");
    expect(statusOf(race({ votes: [10, 9], winner: 0 }))).toBe("called");
  });

  it("separates safe races (evidence, no rating) from unrated ones (no evidence)", () => {
    expect(tierOf(race({ rating: "lean-r" }))).toBe("lean");
    expect(tierOf(race({ signal: forecast({ R: 0.97, D: 0.03 }) }))).toBe("safe");
    expect(tierOf(race())).toBe("unrated");
  });

  it("colors a race by its leader, else its rating, else a safe favorite, else nothing", () => {
    const safeR = forecast({ R: 0.97, D: 0.03 });
    expect(safeSide(race({ signal: safeR }))).toBe("R");
    expect(safeSide(race({ rating: "lean-r", signal: { ...safeR, rating: "lean-r" } }))).toBeNull();
    expect(raceFill(race({ signal: safeR }))).toBe("var(--rate-safe-r)");
    expect(raceFill(race({ rating: "lean-d" }))).toBe("var(--rate-lean-d)");
    expect(raceFill(race())).toBe("var(--rule-strong)");
    // Votes outrank the projection.
    expect(raceFill(race({ signal: safeR, votes: [530, 470] }))).toBe("color-mix(in srgb, var(--dem) 45%, var(--sheet))");
    // A call takes the winner's full color; a lead never gets that strong.
    expect(raceFill(race({ votes: [900, 100], winner: 0 }))).toBe("var(--rate-safe-d)");
    expect(raceFill(race({ votes: [900, 100] }))).toBe("color-mix(in srgb, var(--dem) 60%, var(--sheet))");
    // From election day on, a race with no votes is plain grey whatever its forecast.
    expect(raceFill(race({ rating: "lean-d" }), true)).toBe("var(--rule-strong)");
  });

  it("names the leader by party, or Yes/No on a measure", () => {
    expect(leaderOf(race())).toBeNull();
    expect(leaderOf(race({ votes: [3, 9] }))).toBe("R");
    const measure = race({ office: "measure", candidates: [{ name: "No", party: "", votes: 5, pct: 60, winner: false, incumbent: false }, { name: "Yes", party: "", votes: 3, pct: 40, winner: false, incumbent: false }] });
    expect(leaderOf(measure)).toBe("no");
  });
});

describe("explore", () => {
  const close = race({ votes: [510, 490] });
  const wide = race({ votes: [300, 700] });
  const waiting = race({ rating: "tossup" });
  const upset = race({ votes: [600, 400], winner: 0, incumbent: 1, call: { id: 1, at: 5, winner: "Dana Dem", replaced: null, withdrawn: false } });
  const called = race({ votes: [800, 200], winner: 0, call: { id: 2, at: 9, winner: "Dana Dem", replaced: null, withdrawn: false } });
  const flip = race({ votes: [400, 600], winner: 1, call: { id: 3, at: 7, winner: "Rob Rep", replaced: null, withdrawn: false } });
  const house = race({ office: "house", state: "PA", district: 7, title: "PA-07 US House", votes: [5, 4] });
  const all = [called, waiting, wide, upset, close, house];

  it("filters by office and orders by closeness: counted margins, then awaiting, then called (newest first)", () => {
    expect(explore(all, f(), null)).toEqual([close, wide, waiting, called, upset]);
  });

  it("applies quick views", () => {
    expect(explore(all, f({ view: "close" }), null)).toEqual([close]);
    // Georgia's class 2 seat is held by a Democrat going in: a Republican lead there is a leading flip, a Republican win a gain.
    expect(explore(all, f({ view: "gains" }), null)).toEqual([wide]);
    expect(explore([...all, flip], f({ view: "gains" }), null)).toEqual([wide, flip]);
    expect(explore(all, f({ view: "key" }), null)).toEqual([waiting]);
    expect(explore(all, f({ view: "mine" }), [wide.id])).toEqual([wide]);
    expect(explore(all, f({ view: "mine" }), null)).toEqual([]);
  });

  it("combines status, leader, margin, reporting, state and search filters", () => {
    expect(explore(all, f({ status: ["called"], sort: "called" }), null)).toEqual([called, upset]);
    expect(explore(all, f({ leaders: ["R"] }), null)).toEqual([wide]);
    expect(explore(all, f({ maxMargin: 3 }), null)).toEqual([close]);
    expect(explore(all, f({ office: "all", states: ["PA"] }), null)).toEqual([house]);
    expect(explore(all, f({ office: "all", q: "pa-7" }), null)).toEqual([house]);
    expect(explore(all, f({ minReporting: 1, status: ["counting"] }), null)).toEqual([close, wide]);
  });

  it("counts each quick view under the other filters", () => {
    expect(viewCounts(all, f(), [close.id])).toEqual({ all: 5, key: 1, uncalled: 3, close: 1, gains: 1, mine: 1 });
  });
});

describe("filters in the URL", () => {
  it("round-trips every filter and drops defaults", () => {
    const filters = f({ office: "house", view: "close", q: "smith", states: ["PA", "AZ"], status: ["counting"], tiers: ["tossup", "safe"], leaders: ["D"], maxMargin: 5, minReporting: 50, waves: [Date.parse("2026-11-04T00:00:00Z")], sort: "reporting" });
    expect(fromQuery(new URLSearchParams(toQuery(filters)))).toEqual(filters);
    expect(toQuery(DEFAULT_FILTERS)).toBe("");
    expect(activeCount(filters)).toBe(8);
  });

  it("ignores junk", () => {
    expect(fromQuery(new URLSearchParams("office=mayor&states=ZZ,PA&margin=-4&in=500&close=123&sort=evil&tier=tossup,bogus"))).toEqual(f({ states: ["PA"], tiers: ["tossup"] }));
  });
});

describe("early counts", () => {
  it("sort after fuller counts, however close", () => {
    const early = race({ votes: [501, 499], reporting: 10 });
    const full = race({ votes: [520, 480], reporting: 80 });
    expect(explore([early, full], f(), null)).toEqual([full, early]);
  });
});

describe("projected flips", () => {
  const market = (D: number) => forecast({ D, R: 1 - D });

  it("flags a seat whose favorite or leader isn't the party holding it", () => {
    // North Carolina's Senate seat is held by a Republican; Georgia's by a Democrat.
    expect(flipTo(race({ state: "NC", title: "North Carolina US Senate", rating: "lean-d", signal: market(0.7) }))).toBe("D");
    expect(flipTo(race({ state: "GA", rating: "lean-d", signal: market(0.7) }))).toBeNull();
    // A toss-up favors nobody yet.
    expect(flipTo(race({ state: "NC", title: "North Carolina US Senate", rating: "tossup", signal: market(0.55) }))).toBeNull();
    // Once votes are in, the leader decides, then the winner.
    expect(flipTo(race({ state: "GA", signal: market(0.9), votes: [400, 600] }))).toBe("R");
    expect(flipTo(race({ state: "GA", signal: market(0.1), votes: [600, 400], winner: 0 }))).toBeNull();
  });
});

describe("competitive order", () => {
  it("puts the race closest to a coin flip first within a rating, and races with no evidence last", () => {
    const district = (district: number, D: number | null) =>
      race({ office: "house", state: "CA", district, title: `California US House ${district}`, signal: D === null ? null : forecast({ D, R: 1 - D }) });
    const order = [district(1, null), district(2, 0.99), district(3, 0.08), district(4, 0.96)].sort(compareRaces).map((r) => r.district);
    expect(order).toEqual([3, 4, 2, 1]);
  });
});
