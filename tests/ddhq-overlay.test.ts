import { describe, expect, it } from "vitest";
import type { ForecastOverview } from "../app/api/midterms/forecast/route";
import { applyDesk, deskFor, overlayLive, isDesk } from "../lib/ddhq/apply";
import type { DdhqForecastBundle } from "../lib/ddhq/forecast-types";
import type { DdhqRace } from "../lib/ddhq/votes";
import { safeSide, tierOf } from "../lib/midterms/explore";
import type { Forecast } from "../lib/midterms/forecast";
import { balance, type RaceDetail, type RaceSummary } from "../lib/midterms/races";
import { chances, forecastLeader, type Overview } from "../lib/midterms/view";

function civic(): RaceSummary {
  const forecast: Forecast = {
    odds: { D: 0.3, R: 0.7 }, left: "D", names: { left: "Dana Old", right: "Riley Old" },
    margin: -3, lean: -4, incumbency: 2, fundraising: 1, personal: 2, sigma: 6,
    fundamentals: -1, environment: 1, pollWeight: 0.4, pollMargin: -5,
    marketWeight: 0.2, market: 0.3, expert: 0.2, expertWeight: 0.1,
  };
  return {
    id: 1, state: "GA", office: "senate", district: null, title: "US Senate",
    total: 100, reporting: 10, rating: "lean-r", calledFor: null,
    candidates: [
      { name: "Dana Old", party: "Democratic", votes: 60, pct: 60, winner: false, incumbent: true },
      { name: "Riley Old", party: "Republican", votes: 40, pct: 40, winner: false, incumbent: false },
    ],
    signal: { rating: "lean-r", market: null, polls: null, forecast },
  };
}

function desk(overrides: Partial<DdhqRace> = {}): DdhqRace {
  return {
    forecast: [
      { name: "Dana Nominee", party: "D", probability: 0.89 },
      { name: "Riley Opponent", party: "R", probability: 0.11 },
    ],
    rating: "likely-d", updatedAt: 20, candidates: null, call: null, counties: [], total: 0,
    ...overrides,
  };
}

function overview(race: RaceSummary): Overview {
  return { races: [race], balance: balance([race]), fetchedAt: 10, stale: false, ratings: { updatedAt: 10 }, callEvents: [], callEventCounts: { senate: 2, house: 0, governor: 0, measure: 0 } };
}

function published(): DdhqForecastBundle["overview"] {
  return {
    source: "ddhq", updatedAt: 20,
    chambers: {
      senate: {
        dControl: 0.62, dSeats: 52, rSeats: 48, majority: 51,
        ratings: { safeD: 9, likelyD: 4, leanD: 1, tossup: 6, leanR: 2, likelyR: 4, safeR: 9, other: 0 },
        distribution: [{ seats: 52, p: 1 }], notUp: { D: 34, R: 31, other: 0 },
      },
    },
    history: { senate: [["2026-10-30", 0.62, 52, 48]], house: [], governor: [] },
  };
}

describe("private DDHQ forecast overlay", () => {
  it("replaces forecast-only odds, names and rating without changing civic vote totals", () => {
    const raw = civic();
    const before = structuredClone(raw);
    const source = desk();
    const next = applyDesk(raw, source);
    expect(chances(next.signal)).toEqual({ D: 0.89, R: 0.11 });
    expect(next.rating).toBe("likely-d");
    expect(next.signal?.forecast?.names).toEqual({ left: "Dana Nominee", right: "Riley Opponent" });
    expect(forecastLeader(next)).toBe("Nominee 89%");
    expect(next.candidates.slice(0, 2)).toEqual(raw.candidates);
    expect(next.candidates.slice(2).every((candidate) => candidate.votes === 0)).toBe(true);
    expect(next.total).toBe(100);
    expect(next.reporting).toBe(raw.reporting);
    expect(isDesk(next)).toBe(false);
    expect(deskFor(next)).toBe(source);
    expect(deskFor(raw)).toBeUndefined();
    expect(raw).toEqual(before);
  });

  it("does not retain local model coefficients or claim they explain DDHQ odds", () => {
    const forecast = applyDesk(civic(), desk()).signal!.forecast!;
    expect(forecast).toMatchObject({ source: "ddhq", updatedAt: 20, margin: null, lean: null, fundamentals: null, environment: null, pollWeight: 0, marketWeight: 0 });
    expect(forecast).not.toHaveProperty("sigma");
    expect(forecast).not.toHaveProperty("fundraising");
    expect(forecast).not.toHaveProperty("personal");
    expect(forecast).not.toHaveProperty("expert");
  });

  it("honors DDHQ's published Safe category and clears the previous toss-up", () => {
    const raw = { ...civic(), rating: "tossup" as const };
    const next = applyDesk(raw, desk({ rating: null }));
    expect(next.rating).toBeNull();
    expect(next.signal?.rating).toBeNull();
    expect(tierOf(next)).toBe("safe");
    expect(safeSide(next)).toBe("D");
  });

  it.each([0.6, 0.7, 0.99])("shows legacy DDHQ odds of %s without inventing a published category", (probability) => {
    const next = applyDesk(civic(), desk({ rating: undefined, forecast: [{ name: "Dana Nominee", party: "D", probability }, { name: "Riley Opponent", party: "R", probability: 1 - probability }] }));
    expect(next.rating).toBeNull();
    expect(next.signal?.forecast?.ratingKnown).toBe(false);
    expect(chances(next.signal)?.D).toBe(probability);
    expect(tierOf(next)).toBe("unrated");
    expect(safeSide(next)).toBeNull();
  });

  it.each([true, false])("keeps the published forecast when a count response omits its category (has odds: %s)", (hasOdds) => {
    const source = desk({ rating: "tossup", forecast: [{ name: "Dana Nominee", party: "D", probability: 0.6 }, { name: "Riley Opponent", party: "R", probability: 0.4 }] });
    const loaded = applyDesk(civic(), source);
    const direct = desk({ rating: undefined, updatedAt: 30, total: 200,
      forecast: hasOdds ? [{ name: "Dana Nominee", party: "D", probability: 0.7 }, { name: "Riley Opponent", party: "R", probability: 0.3 }] : [],
      candidates: [{ name: "Dana Nominee", party: "Democratic", votes: 200, pct: 100, winner: false, incumbent: false }],
    });
    const sourceBefore = structuredClone(source);
    const directBefore = structuredClone(direct);
    const next = applyDesk(loaded, direct);
    expect(next.total).toBe(200);
    expect(next.candidates[0].votes).toBe(200);
    expect(next.rating).toBe("tossup");
    expect(next.signal?.forecast).toMatchObject({ odds: { D: 0.6, R: 0.4 }, updatedAt: 20, ratingKnown: true });
    expect(isDesk(next)).toBe(true);
    expect(deskFor(next)?.forecast).toBe(source.forecast);
    expect(deskFor(next)?.rating).toBe("tossup");
    expect(deskFor(next)?.updatedAt).toBe(20);
    expect(deskFor(next)?.candidates).toBe(direct.candidates);
    expect(loaded.total).toBe(100);
    expect(source).toEqual(sourceBefore);
    expect(direct).toEqual(directBefore);
  });

  it("accepts a newer response when it includes its own published category", () => {
    const loaded = applyDesk(civic(), desk({ rating: "tossup" }));
    const direct = desk({ rating: null, updatedAt: 30, forecast: [{ name: "Dana Nominee", party: "D", probability: 0.97 }, { name: "Riley Opponent", party: "R", probability: 0.03 }] });
    const next = applyDesk(loaded, direct);
    expect(next.signal?.forecast).toMatchObject({ odds: { D: 0.97, R: 0.03 }, updatedAt: 30, ratingKnown: true });
    expect(tierOf(next)).toBe("safe");
    expect(deskFor(next)).toBe(direct);
  });

  it("replaces counts and calls independently when DDHQ has no forecast", () => {
    const raw = civic();
    const next = applyDesk(raw, desk({ forecast: [], candidates: [{ name: "Dana Old", party: "Democratic", votes: 90, pct: 100, winner: true, incumbent: true }], total: 90, call: { name: "Dana Old", at: "2026-11-04T03:00:00Z" } }));
    expect(next.total).toBe(90);
    expect(next.calledFor).toBe("Dana Old");
    expect(next.signal).toBe(raw.signal);
    expect(next.rating).toBe(raw.rating);
    expect(isDesk(next)).toBe(true);
    expect(raw.total).toBe(100);
  });

  it("applies both sources and clears a stale public call when DDHQ has not called it", () => {
    const raw = { ...civic(), calledFor: "Dana Old", call: { id: 1, at: 5, winner: "Dana Old", replaced: null, withdrawn: false as const } };
    const next = applyDesk(raw, desk({ candidates: [{ name: "Dana Nominee", party: "Democratic", votes: 20, pct: 100, winner: false, incumbent: false }], total: 20 }));
    expect(next.total).toBe(20);
    expect(next.call).toBeNull();
    expect(next.calledFor).toBeNull();
    expect(next.signal?.forecast?.source).toBe("ddhq");
    expect(isDesk(next)).toBe(true);
  });

  it("overlays overview forecasts without rebuilding unchanged counts or call history", () => {
    const raw = overview(civic());
    const next = overlayLive("/api/midterms", raw, new Map([["senate:GA::g", desk()]]), published());
    expect(next.races[0].rating).toBe("likely-d");
    expect(next.balance).toBe(raw.balance);
    expect(next.callEvents).toBe(raw.callEvents);
    expect(next.callEventCounts).toBe(raw.callEventCounts);
    expect(next.forecastSource).toBe("ddhq");
    expect(next.ratings.updatedAt).toBe(20);
    expect(raw.forecastSource).toBeUndefined();
    expect(raw.ratings.updatedAt).toBe(10);
  });

  it("overlays race detail forecasts without requiring a DDHQ count", () => {
    const raw = { race: { ...civic(), counties: [], pollsClose: null, updated: null } as RaceDetail };
    const next = overlayLive("/api/midterms/race/1", raw, new Map([["senate:GA::g", desk()]]));
    expect(next.race.signal?.forecast?.source).toBe("ddhq");
    expect(next.race.total).toBe(raw.race.total);
    expect(raw.race.signal?.forecast?.source).toBeUndefined();
  });

  it("uses actual private chamber values and history, with no public-model merge", () => {
    const privateForecast = published();
    const raw: ForecastOverview = { updatedAt: 10, chambers: { governor: { ...privateForecast.chambers!.senate!, dSeats: 26, rSeats: 24 } }, history: { house: [], senate: [["2026-10-29", 0.5, 50, 50]], governor: [["2026-10-29", 0.6, 26, 24]], backfilled: { from: "2026-10-01", to: "2026-10-29", markets: "none" } } };
    const before = structuredClone(raw);
    const next = overlayLive("/api/midterms/forecast", raw, new Map(), privateForecast);
    expect(next).toBe(privateForecast);
    expect(next.chambers?.senate?.dSeats).toBe(52);
    expect(next.chambers?.governor).toBeUndefined();
    expect(next.history?.backfilled).toBeUndefined();
    expect(raw).toEqual(before);
    expect(overlayLive("/api/midterms/forecast", null, new Map(), privateForecast)).toBe(privateForecast);
  });

  it("restores the untouched public object when private data is off or unavailable", () => {
    const raw = overview(civic());
    expect(overlayLive("/api/midterms", raw, new Map(), null)).toBe(raw);
    expect(applyDesk(raw.races[0], desk({ forecast: [], candidates: null }))).toBe(raw.races[0]);
    const publicForecast: ForecastOverview = { updatedAt: 10, chambers: null, history: null };
    expect(overlayLive("/api/midterms/forecast", publicForecast, new Map(), null)).toBe(publicForecast);
  });

  it.each(["senate", "house", "governor"] as const)("clears an unlisted %s projection when the DDHQ bundle is active", (office) => {
    const race = { ...civic(), office, district: office === "house" ? 1 : null };
    const measure = { ...civic(), id: 2, office: "measure" as const };
    const raw = { ...overview(race), races: [race, measure] };
    const before = structuredClone(raw);
    const next = overlayLive("/api/midterms", raw, new Map(), published());
    expect(next.races[0].rating).toBeNull();
    expect(next.races[0].signal).toBeNull();
    expect(next.races[0].total).toBe(race.total);
    expect(next.races[0].candidates).toBe(race.candidates);
    expect(next.races[1]).toBe(measure);
    expect(next.forecastSource).toBe("ddhq");
    expect(isDesk(next.races[0])).toBe(false);
    expect(raw).toEqual(before);
    expect(overlayLive("/api/midterms", raw, new Map(), null)).toBe(raw);
  });

  it("keeps DDHQ counts and their source marker while clearing an unavailable forecast", () => {
    const raw = overview(civic());
    const counts = desk({ forecast: [], candidates: [{ name: "Dana Old", party: "Democratic", votes: 80, pct: 100, winner: false, incumbent: true }], total: 80 });
    const next = overlayLive("/api/midterms", raw, new Map([["senate:GA::g", counts]]), published());
    expect(next.races[0].total).toBe(80);
    expect(next.races[0].signal).toBeNull();
    expect(next.races[0].rating).toBeNull();
    expect(isDesk(next.races[0])).toBe(true);
    expect(deskFor(next.races[0])).toBe(counts);
    expect(raw.races[0].signal?.forecast?.odds).toEqual({ D: 0.3, R: 0.7 });
  });

  it("also clears an unlisted detail projection without changing its fallback count", () => {
    const raw = { race: { ...civic(), counties: [], pollsClose: null, updated: null } as RaceDetail };
    const next = overlayLive("/api/midterms/race/1", raw, new Map(), published());
    expect(next.race.signal).toBeNull();
    expect(next.race.rating).toBeNull();
    expect(next.race.candidates).toBe(raw.race.candidates);
    expect(next.race.total).toBe(raw.race.total);
    expect(raw.race.signal?.forecast).toBeDefined();
  });
});
