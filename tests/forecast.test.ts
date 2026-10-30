import { describe, expect, it } from "vitest";
import { chamberViews, forecastRace, marketWeight, matchup, modelFor, PARAMS, phi, phiInverse, pollWeight, ratingOf, sigmaOf, TUNING, type Inputs } from "../lib/midterms/forecast";
import { aggregateMedian, parseAggregates } from "../lib/midterms/genericAggregates";
import { averageAt, genericBallot, racePolls, type VoteHubPoll } from "../lib/midterms/pollAverage";

const cand = (name: string, party: string) => ({ name, party, votes: 0, pct: 0, winner: false, incumbent: false });
const inputs = (over: Partial<Inputs> = {}): Inputs => ({ office: "senate", lean: 0, genericBallot: null, incumbent: null, polls: null, market: null, ...over });
const contest = { kind: "contest" as const, left: "D" as const, leftName: "Dana Dem", rightName: "Rob Rep" };

describe("normal curve", () => {
  it("matches known values and inverts", () => {
    expect(phi(0)).toBeCloseTo(0.5, 6);
    expect(phi(1.96)).toBeCloseTo(0.975, 3);
    expect(phi(-1)).toBeCloseTo(0.1587, 3);
    for (const p of [0.01, 0.2, 0.5, 0.9, 0.999]) expect(phi(phiInverse(p))).toBeCloseTo(p, 4);
  });
});

describe("matchup", () => {
  it("pits the Democrat against the Republican, or an independent where no Democrat runs", () => {
    expect(matchup({ state: "GA", candidates: [cand("Jon Ossoff", "Democratic"), cand("Mike Collins", "Republican"), cand("Ana Lib", "Libertarian")] })).toMatchObject({ kind: "contest", left: "D", leftName: "Jon Ossoff", rightName: "Mike Collins" });
    expect(matchup({ state: "NE", candidates: [cand("Pete Ricketts", "Republican"), cand("Dan Osborn", "Independent")] })).toMatchObject({ kind: "contest", left: "I", leftName: "Dan Osborn" });
  });

  it("takes the incumbent when a party runs several candidates", () => {
    const ak = { state: "AK", candidates: [cand("Mary Peltola", "Democratic"), cand("Gerald L. Heikes", "Republican"), cand("Dan Sullivan", "Republican")] };
    expect(matchup(ak, "Dan Sullivan")).toMatchObject({ kind: "contest", rightName: "Dan Sullivan" });
  });

  it("calls one-sided races uncontested and same-party or top-two races open", () => {
    expect(matchup({ state: "FL", candidates: [cand("Maxwell Frost", "Democratic")] })).toEqual({ kind: "uncontested", side: "D", alone: true });
    expect(matchup({ state: "MA", candidates: [cand("Richard Neal", "Democratic"), cand("N. Milleron", "Independent/Unenrolled")] })).toEqual({ kind: "uncontested", side: "D", alone: false });
    expect(matchup({ state: "CA", candidates: [cand("Scott Wiener", "Democratic"), cand("Connie Chan", "Democratic")] })).toEqual({ kind: "open" });
    expect(matchup({ state: "CA", candidates: [cand("Richard Pan", "Democratic"), cand("Kevin Kiley", "No Party Preference")] })).toEqual({ kind: "open" });
  });
});

describe("forecastRace", () => {
  it("builds the fundamentals margin from the fitted lean, environment and incumbency terms", () => {
    const f = forecastRace(contest, inputs({ lean: -2, genericBallot: 6.5, incumbent: "D" }))!;
    const c = modelFor("senate", false).coefficients;
    expect(f.environment).toBeCloseTo(TUNING.environment * c.environment * 6.5, 1);
    expect(f.fundamentals).toBeCloseTo(c.intercept + c.lean * (-2 - PARAMS.national2024) + TUNING.environment * c.environment * 6.5 + c.incumbent, 1);
    expect(f.odds.D).toBeCloseTo(phi(f.fundamentals! / sigmaOf(modelFor("senate", false), "senate")), 2);
    expect(f.odds.D! + f.odds.R!).toBeCloseTo(1, 6);
  });

  it("scales each model's held-out σ by its office's multiplier, using the midterm σ where it scored better", () => {
    const senate = modelFor("senate", true);
    expect(sigmaOf(senate, "senate")).toBeCloseTo(TUNING.k.senate * (senate.calibration.midtermSigma ?? senate.sigma), 6);
    expect(sigmaOf(senate, "senate", { ...TUNING, k: { ...TUNING.k, senate: 2 } })).toBeCloseTo(2 * (senate.calibration.midtermSigma ?? senate.sigma), 6);
  });

  it("adds the incumbent's personal vote only when the incumbent is on the ballot", () => {
    const c = modelFor("senate", false).coefficients;
    const open = forecastRace(contest, inputs({ lean: 0, genericBallot: 0, personal: -17 }))!;
    const held = forecastRace(contest, inputs({ lean: 0, genericBallot: 0, incumbent: "R", personal: -17 }))!;
    expect(open.personal).toBeNull();
    expect(held.personal).toBeCloseTo(TUNING.personal.senate * c.personal * -17, 1);
    expect(held.fundamentals! - open.fundamentals!).toBeCloseTo(-c.incumbent + held.personal!, 0);
  });

  it("adds fundraising only when both sides have FEC receipts, using the model fit with it", () => {
    const without = forecastRace(contest, inputs({ office: "house", lean: 0, genericBallot: 0 }))!;
    const withMoney = forecastRace(contest, inputs({ office: "house", lean: 0, genericBallot: 0, fundraising: 1 }))!;
    expect(without.fundraising).toBeNull();
    expect(withMoney.fundraising).toBeCloseTo(modelFor("house", true).coefficients.fundraising!, 1);
    expect(withMoney.sigma).toBeLessThan(without.sigma!);
  });

  it("governors use the statewide fit without fundraising", () => {
    expect(modelFor("governor", true)).toBe(modelFor("senate", false));
  });

  it("weighs polls by how many there are, up to the cap", () => {
    expect(pollWeight(1)).toBe(0);
    expect(pollWeight(PARAMS.polls.full / 2)).toBeCloseTo(PARAMS.polls.max / 2, 6);
    expect(pollWeight(40)).toBe(PARAMS.polls.max);
    const f = forecastRace(contest, inputs({ lean: 0, polls: { margin: 10, count: 40 } }))!;
    expect(f.margin).toBeCloseTo((1 - PARAMS.polls.max) * f.fundamentals! + PARAMS.polls.max * 10, 0);
  });

  it("weighs markets by volume on a log scale, clipping extreme prices", () => {
    const max = TUNING.markets.max.senate;
    expect(marketWeight(undefined, "senate")).toBe(0);
    expect(marketWeight(PARAMS.markets.min - 1, "senate")).toBe(0);
    expect(marketWeight(PARAMS.markets.full * 10, "senate")).toBe(max);
    const f = forecastRace(contest, inputs({ lean: 0, market: { odds: { D: 1, R: 0 }, volume: 5_000_000 } }))!;
    const base = phi(f.margin! / f.sigma!);
    expect(f.market).toBe(1 - PARAMS.markets.clip);
    expect(f.odds.D).toBeCloseTo((1 - max) * base + max * (1 - PARAMS.markets.clip), 2);
  });

  it("blends the expert raters' average chance in at the office's weight, and uses it alone when nothing else is known", () => {
    const experts = [{ side: "D" as const, p: 0.68 }, { side: null, p: 0.5 }, { side: "R" as const, p: 0.68 }];
    const without = forecastRace(contest, inputs({ lean: 4, genericBallot: 0 }))!;
    const withExperts = forecastRace(contest, inputs({ lean: 4, genericBallot: 0, experts }))!;
    const w = TUNING.experts.senate;
    expect(withExperts.expert).toBeCloseTo((0.68 + 0.5 + 0.32) / 3, 3);
    expect(withExperts.expertWeight).toBe(w);
    expect(withExperts.odds.D).toBeCloseTo((1 - w) * without.odds.D! + w * withExperts.expert!, 2);
    expect(forecastRace(contest, inputs({ lean: null, experts: [{ side: "R", p: 0.85 }] }))!.odds.D).toBeCloseTo(0.15, 3);
  });

  it("uses the market alone when nothing else is known, and nothing at all with no evidence", () => {
    expect(forecastRace(contest, inputs({ lean: null, market: { odds: { D: 0.7, R: 0.3 }, volume: 50 } }))!.odds.D).toBeCloseTo(0.7, 3);
    expect(forecastRace(contest, inputs({ lean: null }))).toBeNull();
    expect(forecastRace({ kind: "open" }, inputs())).toBeNull();
  });

  it("gives an uncontested seat to its only side, unless a market says the challenger is real", () => {
    expect(forecastRace({ kind: "uncontested", side: "D", alone: true }, inputs())!.odds).toEqual({ D: 1 });
    expect(forecastRace({ kind: "uncontested", side: "D", alone: false }, inputs())!.odds).toEqual({ D: 0.99 });
    expect(forecastRace({ kind: "uncontested", side: "D", alone: false }, inputs({ market: { odds: { D: 0.7, I: 0.3 } } }))!.odds).toEqual({ D: 0.7, I: 0.3 });
  });

  it("forecasts an independent against the Republican", () => {
    const f = forecastRace({ kind: "contest", left: "I", leftName: "Dan Osborn", rightName: "Pete Ricketts" }, inputs({ lean: -20, market: { odds: { R: 0.7, I: 0.3 }, volume: 2_000_000 } }))!;
    expect(f.left).toBe("I");
    expect(f.odds.I).toBeGreaterThan(0.1);
    expect(ratingOf(f)).toBe("likely-r");
  });
});

describe("ratingOf", () => {
  it("uses DDHQ's thresholds: Safe at 95%, Likely at 75%, Lean above 60%", () => {
    expect(ratingOf({ odds: { D: 0.95, R: 0.05 } })).toBeNull();
    expect(ratingOf({ odds: { D: 0.94, R: 0.06 } })).toBe("likely-d");
    expect(ratingOf({ odds: { D: 0.25, R: 0.75 } })).toBe("likely-r");
    expect(ratingOf({ odds: { D: 0.26, R: 0.74 } })).toBe("lean-r");
    expect(ratingOf({ odds: { I: 0.61, R: 0.39 } })).toBe("lean-i");
    expect(ratingOf({ odds: { D: 0.6, R: 0.4 } })).toBe("tossup");
    expect(ratingOf({ odds: { D: 0.5, R: 0.5 } })).toBe("tossup");
    expect(ratingOf(null)).toBeNull();
  });
});

describe("chamberViews", () => {
  it("counts certain seats exactly, with seats not up, and rates each race", () => {
    const sure = Array.from({ length: 218 }, () => ({ office: "house" as const, forecast: { odds: { D: 1 } } }));
    const v = chamberViews(sure, 200);
    expect(v.house).toMatchObject({ dControl: 1, dSeats: 218, rSeats: 0, majority: 218, notUp: { D: 0, R: 0, other: 0 } });
    expect(v.house.ratings.safeD).toBe(218);
    expect(v.house.distribution).toEqual([{ seats: 218, p: 1 }]);
    // No Senate races given: only the 65 seats not up.
    expect(v.senate).toMatchObject({ dSeats: 34, rSeats: 31, dControl: 0, majority: 51 });
    expect(v.governor).toMatchObject({ dSeats: 6, rSeats: 8, majority: 26 });
  });

  it("splits coin flips around half, and buckets ratings by the forecast", () => {
    const flips = Array.from({ length: 435 }, () => ({ office: "house" as const, forecast: { odds: { D: 0.5, R: 0.5 } } }));
    const h = chamberViews(flips, 2000).house;
    expect(h.dSeats).toBeGreaterThan(205);
    expect(h.dSeats).toBeLessThan(230);
    expect(h.dSeats + h.rSeats).toBe(435);
    expect(h.ratings.tossup).toBe(435);
    expect(h.distribution.reduce((s, b) => s + b.p, 0)).toBeCloseTo(1, 2);
    const mixed = chamberViews([
      { office: "senate", forecast: { odds: { D: 0.8, R: 0.2 } } },
      { office: "senate", forecast: { odds: { R: 0.7, I: 0.3 } } },
      { office: "governor", forecast: null },
    ]);
    expect(mixed.senate.ratings).toMatchObject({ likelyD: 1, leanR: 1 });
    expect(mixed.governor.ratings.other).toBe(1);
  });
});

describe("polling average", () => {
  const m = { kind: "contest" as const, left: "D" as const, leftName: "Aaron Ford", rightName: "Joe Lombardo" };
  const NOW = Date.parse("2026-10-30T12:00:00Z");
  const poll = (over: Partial<VoteHubPoll>): VoteHubPoll => ({ pollster: "A", start_date: "2026-10-01", end_date: "2026-10-03", sample_size: 600, population: "lv", answers: [{ choice: "Aaron Ford", pct: 48 }, { choice: "Joe Lombardo", pct: 44 }], ...over });

  it("reads the right Ford when two candidates share a last name", () => {
    const r = racePolls([poll({ answers: [{ choice: "Joe Lombardo", pct: 42 }, { choice: "Aaron Ford", pct: 44 }, { choice: "Danielle Ford", pct: 2 }] })], m, NOW);
    expect(r.rows[0].margin).toBe(2);
  });

  it("prefers the likely-voter version of a poll and folds a campaign's later internals into its first", () => {
    const r = racePolls(
      [
        poll({ population: "rv", answers: [{ choice: "Ford", pct: 40 }, { choice: "Lombardo", pct: 40 }] }),
        poll({}),
        poll({ pollster: "B", start_date: "2026-09-01", end_date: "2026-09-02", sponsors: ["Ford for Governor"], answers: [{ choice: "Ford", pct: 50 }, { choice: "Lombardo", pct: 40 }] }),
        poll({ pollster: "B", start_date: "2026-10-10", end_date: "2026-10-11", sponsors: ["Ford for Governor"], answers: [{ choice: "Ford", pct: 52 }, { choice: "Lombardo", pct: 40 }] }),
      ],
      m,
      NOW,
    );
    expect(r.rows).toHaveLength(3);
    expect(r.average!.count).toBe(2);
    expect(r.rows.find((x) => x.end === "2026-10-11")!.excluded).toMatch(/averaged into its first/);
    expect(r.rows.every((x) => x.pop !== "rv")).toBe(true);
  });

  it("weights recent polls more with few polls, and follows the trend once there are many", () => {
    const day = (d: number) => ({ t: d, left: 40 + d * 0.1, right: 45 });
    const few = averageAt([day(0), day(100)], 100)!;
    expect(few.left).toBeGreaterThan(45);
    expect(few.left).toBeLessThan(50);
    const many = averageAt(Array.from({ length: 20 }, (_, i) => day(i * 5)), 95)!;
    expect(many.left).toBeCloseTo(40 + 9.5, 0);
    expect(many.count).toBe(20);
  });

  it("doesn't let the trend run on with only a few recent polls", () => {
    // Plenty of polls early, then two late ones far above them: the trend line would chase the two.
    const early = Array.from({ length: 30 }, (_, i) => ({ t: i * 3, left: 45, right: 45 }));
    const late = [{ t: 200, left: 52, right: 44 }, { t: 205, left: 53, right: 43 }];
    const a = averageAt([...early, ...late], 205)!;
    expect(a.left - a.right).toBeGreaterThan(2);
    expect(a.left - a.right).toBeLessThan(9);
  });

  it("averages the generic ballot", () => {
    const gb = genericBallot(
      [poll({ answers: [{ choice: "Dem", pct: 50 }, { choice: "Rep", pct: 45 }] }), poll({ pollster: "B", answers: [{ choice: "Dem", pct: 48 }, { choice: "Rep", pct: 45 }] })],
      NOW,
    );
    expect(gb!.margin).toBeCloseTo(4, 0);
    expect(gb!.count).toBe(2);
  });
});

describe("generic-ballot aggregates", () => {
  const html = `<table class="wikitable sortable"><tr><th>Source of poll<br>aggregation</th><th>Dates<br>administered</th><th>Dates<br>updated</th><th>Republicans</th><th>Democrats</th><th>Other</th><th>Margin</th></tr>
    <tr><td>Decision Desk HQ</td><td>Jan 9, 2025 – Oct 26, 2026</td><td>October 27, 2026</td><td>43.0%</td><td>50.8%</td><td>6.2%</td><td>Democrats +7.8%</td></tr>
    <tr><td>FiftyPlusOne</td><td>Jan 9, 2025 – Oct 26, 2026</td><td>October 27, 2026</td><td>43.4%</td><td>52.2%</td><td>4.4%</td><td>Democrats +8.8%</td></tr>
    <tr><td>RealClearPolitics</td><td>October 9–26, 2026</td><td>October 27, 2026</td><td>43.3%</td><td>51.6%</td><td>5.1%</td><td>Democrats +8.3%</td></tr>
    <tr><td>Old Tracker</td><td>2025</td><td>August 1, 2026</td><td>45%</td><td>44%</td><td>11%</td><td>Republicans +1.0%</td></tr>
    <tr><td>Average</td><td>October 27, 2026</td><td>43.0%</td><td>51.5%</td><td>5.5%</td><td>Democrats +8.5%</td></tr></table>`;

  it("reads the aggregator table and takes the median of current ones, leaving out DDHQ", () => {
    const rows = parseAggregates(html);
    expect(rows.map((r) => [r.source, r.margin])).toEqual([["Decision Desk HQ", 7.8], ["FiftyPlusOne", 8.8], ["RealClearPolitics", 8.3], ["Old Tracker", -1]]);
    const med = aggregateMedian(rows, Date.parse("2026-10-29T12:00:00Z"))!;
    expect(med.margin).toBe(8.6);
    expect(med.sources.map((s) => s.source)).toEqual(["FiftyPlusOne", "RealClearPolitics"]);
  });
});

describe("correlated errors", () => {
  it("widens the seat spread when races share a region and lean bucket", () => {
    const flips = (grouped: boolean) => Array.from({ length: 200 }, () => ({ office: "house" as const, forecast: { odds: { D: 0.5, R: 0.5 } }, ...(grouped ? { region: "Mountain", bucket: 3 } : {}) }));
    const spread = (v: ReturnType<typeof chamberViews>["house"]) => {
      const mean = v.distribution.reduce((s, b) => s + b.seats * b.p, 0);
      return Math.sqrt(v.distribution.reduce((s, b) => s + b.p * (b.seats - mean) ** 2, 0));
    };
    expect(spread(chamberViews(flips(true), 3000).house)).toBeGreaterThan(spread(chamberViews(flips(false), 3000).house));
  });
});
