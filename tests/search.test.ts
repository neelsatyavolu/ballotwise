import { describe, expect, it } from "vitest";
import type { FoundRace } from "../lib/midterms/civic";
import { foundGroup, matchedCandidates, matchTracked, untracked } from "../lib/midterms/search";
import type { RaceSummary } from "../lib/midterms/view";

const race = (id: number, office: RaceSummary["office"], state: string, title: string, names: string[], district: number | null = null) =>
  ({ id, office, state, district, title, rating: null, signal: null, candidates: names.map((name) => ({ name, party: "Democratic", votes: 0, pct: 0, incumbent: false, winner: false })) }) as unknown as RaceSummary;

const races = [
  race(1, "senate", "GA", "Georgia US Senate", ["Jon Ossoff", "Mike Collins"]),
  race(2, "house", "PA", "Pennsylvania House District 7", ["Susan Wild", "Ryan Mackenzie"], 7),
  race(3, "governor", "GA", "Georgia Governor", ["Keisha Lance Bottoms", "Burt Jones"]),
  race(4, "measure", "CA", "California Proposition 50 - Redistricting", []),
];

const found = (id: number, type: string, kind: FoundRace["kind"]): FoundRace => ({ id, title: `${type} ${id}`, state: "TX", type, date: "2026-11-03", kind });

describe("matchTracked", () => {
  it("finds a tracked race by a candidate's name, any case", () => {
    expect(matchTracked(races, "ossoff").map((r) => r.id)).toEqual([1]);
  });

  it("needs every word to match, across the race, its place and its candidates", () => {
    expect(matchTracked(races, "georgia governor").map((r) => r.id)).toEqual([3]);
    expect(matchTracked(races, "georgia").map((r) => r.id)).toEqual([1, 3]);
    expect(matchTracked(races, "PA-7").map((r) => r.id)).toEqual([2]);
  });

  it("lists Senate, then House, governors and measures, and nothing for a blank query", () => {
    expect(matchTracked(races, "a").map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(matchTracked(races, "   ")).toEqual([]);
  });
});

describe("foundGroup", () => {
  it("files civicAPI's results as measures, local races or other statewide ones", () => {
    expect(foundGroup(found(1, "Referendum", "statewide"))).toBe("measures");
    expect(foundGroup(found(2, "Ballot Measure", "local"))).toBe("measures");
    expect(foundGroup(found(3, "Mayor", "local"))).toBe("local");
    expect(foundGroup(found(4, "School Board", "local"))).toBe("local");
    expect(foundGroup(found(5, "County Judge", "other"))).toBe("statewide");
  });
});

describe("untracked", () => {
  it("drops civicAPI results that are already tracked races, so none shows twice", () => {
    expect(untracked([found(1, "US Senate", "statewide"), found(9, "Mayor", "local")], races).map((r) => r.id)).toEqual([9]);
  });
});

describe("matchedCandidates", () => {
  it("names the candidates a search matched, and none when it matched the race itself", () => {
    expect(matchedCandidates(races[0], "ossoff")).toEqual(["Jon Ossoff"]);
    expect(matchedCandidates(races[2], "georgia governor")).toEqual([]);
  });
});
