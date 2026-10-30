import { describe, expect, it } from "vitest";
import { ballotOrder, forecastLeader, nomineeOf, type RaceSummary } from "../lib/midterms/view";

const c = (name: string, party: string, extra: { incumbent?: boolean; votes?: number } = {}) => ({ name, party, votes: 0, pct: 0, incumbent: false, winner: false, ...extra });

// Alaska's top four: civicAPI lists a minor Republican ahead of the incumbent.
const alaska = [c("Mary Peltola", "Democratic"), c("Gerald L. Heikes", "Republican"), c("Dan Sullivan", "Republican", { incumbent: true }), c("John Wayne Howe", "Independent")];
const forecast = (names: { left: string; right: string } | null) =>
  ({ signal: { market: null, polls: null, rating: "tossup", forecast: { odds: { D: 0.43, R: 0.57 }, left: "D", names } }, candidates: alaska }) as unknown as Pick<RaceSummary, "signal" | "candidates">;

describe("nomineeOf", () => {
  it("takes the forecast's named nominee for a party with several candidates", () => {
    expect(nomineeOf(alaska, "R", { left: "Mary Peltola", right: "Dan Sullivan" }, "D")?.name).toBe("Dan Sullivan");
  });

  it("falls back to the incumbent, then the most votes, then the first listed", () => {
    expect(nomineeOf(alaska, "R")?.name).toBe("Dan Sullivan");
    expect(nomineeOf([c("A One", "Republican"), c("B Two", "Republican", { votes: 900 })], "R")?.name).toBe("B Two");
    expect(nomineeOf([c("A One", "Republican"), c("B Two", "Republican")], "R")?.name).toBe("A One");
    expect(nomineeOf(alaska, "I")?.name).toBe("John Wayne Howe");
    expect(nomineeOf(alaska, "D", { left: "Mary Peltola", right: "Dan Sullivan" }, "D")?.name).toBe("Mary Peltola");
  });
});

describe("forecastLeader", () => {
  it("names the party's nominee, not its first-listed candidate", () => {
    expect(forecastLeader(forecast({ left: "Mary Peltola", right: "Dan Sullivan" }))).toBe("Sullivan 57%");
    expect(forecastLeader(forecast(null))).toBe("Sullivan 57%");
  });
});

describe("ballotOrder", () => {
  const race = (total: number, names: { left: string; right: string } | null, candidates = alaska) =>
    ({ total, candidates, signal: { market: null, polls: null, rating: "tossup", forecast: { odds: { D: 0.43, R: 0.57 }, left: "D", names } } }) as unknown as RaceSummary;

  it("puts the nominees first before any votes, the favorite leading, then the rest as listed", () => {
    expect(ballotOrder(race(0, { left: "Mary Peltola", right: "Dan Sullivan" })).map((c) => c.name)).toEqual(["Dan Sullivan", "Mary Peltola", "Gerald L. Heikes", "John Wayne Howe"]);
  });

  it("keeps the count's order once votes are in", () => {
    expect(ballotOrder(race(100, null)).map((c) => c.name)).toEqual(alaska.map((x) => x.name));
  });

  it("leaves a race without a forecast as listed", () => {
    const bare = { total: 0, candidates: alaska, signal: null } as unknown as RaceSummary;
    expect(ballotOrder(bare).map((c) => c.name)).toEqual(alaska.map((x) => x.name));
  });
});
