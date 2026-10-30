import { describe, expect, it } from "vitest";
import type { Forecast } from "../lib/midterms/forecast";
import { chamberFromRaces, confidenceWord, headline, weekChange, withServer, type ChamberView } from "../lib/midterms/forecastTab";
import type { RaceSummary, Rating, Tally } from "../lib/midterms/view";

let nextId = 1;
function race(office: RaceSummary["office"], odds: Partial<Record<"D" | "R" | "I", number>> | null, rating: Rating | null = null, winner?: "D" | "R"): RaceSummary {
  const forecast = odds ? ({ odds } as unknown as Forecast) : null;
  return {
    id: nextId++,
    office,
    state: "PA",
    district: office === "house" ? nextId : null,
    title: "Race",
    reporting: 0,
    total: 0,
    candidates: [
      { name: "Dana Dem", party: "Democratic", votes: 0, pct: 0, winner: winner === "D", incumbent: false },
      { name: "Rob Rep", party: "Republican", votes: 0, pct: 0, winner: winner === "R", incumbent: false },
    ],
    rating,
    signal: { market: null, polls: null, rating, forecast },
  };
}
const tally = (over: Partial<Tally> = {}): Tally => ({ D: 0, R: 0, other: 0, total: 435, majority: 218, uncalled: 0, ...over });
const view = (over: Partial<ChamberView>): ChamberView => ({ dControl: null, dSeats: 0, rSeats: 0, ratings: { safeD: 0, likelyD: 0, leanD: 0, tossup: 0, leanR: 0, likelyR: 0, safeR: 0, other: 0 }, notUp: { D: 0, R: 0, other: 0 }, majority: 218, total: 435, ...over });

describe("forecast headline", () => {
  it("words the favorite's chance on DDHQ's scale", () => {
    expect(confidenceWord(0.59)).toBeNull();
    expect(confidenceWord(0.6)).toBe("narrowly favored");
    expect(confidenceWord(0.7)).toBe("favored");
    expect(confidenceWord(0.8)).toBe("likely");
    expect(confidenceWord(0.949)).toBe("likely");
    expect(confidenceWord(0.95)).toBe("very likely");
  });

  it("reads like DDHQ's, and calls a close chamber a toss-up", () => {
    const text = (parts: { text: string }[]) => parts.map((p) => p.text).join(" ");
    expect(text(headline("house", view({ dControl: 0.8 })))).toBe("Democrats are likely to win the House");
    expect(text(headline("senate", view({ dControl: 0.35 })))).toBe("Republicans are narrowly favored to win the Senate");
    expect(text(headline("senate", view({ dControl: 0.52 })))).toBe("The Senate is a toss-up");
    expect(headline("house", view({ dControl: 0.8 })).find((p) => p.tone === "word")?.text).toBe("likely");
    // Governors have nothing to control: the headline is about holding the most.
    expect(text(headline("governor", view({ dSeats: 24, rSeats: 26, majority: null })))).toBe("Republicans are projected to hold the most governorships");
  });
});

describe("chamber fallback from race forecasts", () => {
  it("counts seats by rating and adds up each side's chances", () => {
    const races = [race("house", { D: 0.97, R: 0.03 }), race("house", { D: 0.8, R: 0.2 }, "likely-d"), race("house", { D: 0.52, R: 0.48 }, "tossup"), race("house", { D: 0.3, R: 0.7 }, "lean-r"), race("house", null), race("senate", { D: 0.9, R: 0.1 }, "likely-d")];
    const v = chamberFromRaces(races, "house", tally());
    expect(v.ratings).toMatchObject({ safeD: 1, likelyD: 1, tossup: 1, leanR: 1, other: 1, safeR: 0 });
    expect(v.dSeats).toBe(Math.round(0.97 + 0.8 + 0.52 + 0.3));
    expect(v.rSeats).toBe(Math.round(0.03 + 0.2 + 0.48 + 0.7));
    expect(v.dControl).toBeNull();
  });

  it("counts seats not up and called races as safe, and leaves called races out of the chances", () => {
    const v = chamberFromRaces([race("senate", { D: 0.6, R: 0.4 }, "tossup"), race("senate", { D: 0.2, R: 0.8 }, "likely-r", "D")], "senate", tally({ D: 35, R: 31, total: 100, majority: 51 }));
    expect(v.ratings.safeD).toBe(35);
    expect(v.ratings.safeR).toBe(31);
    expect(v.ratings.likelyR).toBe(0);
    expect(v.dSeats).toBe(Math.round(35 + 0.6));
    expect(v.majority).toBe(51);
  });

  it("takes the simulation when the server has it, with seats not up counted as Safe", () => {
    const base = chamberFromRaces([race("senate", { D: 0.6, R: 0.4 }, "tossup")], "senate", tally({ D: 34, R: 31, total: 100, majority: 51 }));
    const ratings = { safeD: 10, likelyD: 4, leanD: 2, tossup: 4, leanR: 3, likelyR: 4, safeR: 8, other: 0 };
    const server = { dControl: 0.58, dSeats: 51.4, rSeats: 48.6, ratings, distribution: [], notUp: { D: 34, R: 31, other: 0 }, majority: 51 };
    const merged = withServer(base, server, "senate");
    expect(merged).toMatchObject({ dControl: 0.58, dSeats: 51, rSeats: 49, majority: 51 });
    expect(merged.ratings.safeD).toBe(44);
    expect(merged.ratings.safeR).toBe(39);
    // Governors show projected governorships, not a chance of control.
    expect(withServer(base, server, "governor")).toMatchObject({ dControl: null, majority: null });
    expect(withServer(base, null, "senate")).toBe(base);
  });

  it("only reports a weekly change once the history reaches back a week", () => {
    const day = 86_400;
    expect(weekChange([[0, 0.5], [3 * day, 0.6]])).toBeNull();
    expect(weekChange([[0, 0.5], [3 * day, 0.55], [8 * day, 0.6]])).toBeCloseTo(0.1);
  });
});
