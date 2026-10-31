import { describe, expect, it } from "vitest";
import { closestFirst } from "../lib/midterms/explore";
import type { RaceSummary } from "../lib/midterms/view";

const race = (id: number, lead: number, over: Partial<RaceSummary> = {}): RaceSummary => ({
  id,
  office: "house",
  state: "AZ",
  district: id,
  title: `AZ-${id}`,
  reporting: 50,
  total: 200,
  rating: null,
  candidates: [
    { name: `Lead ${id}`, party: "Democratic", votes: 100 + lead, pct: 50 + lead / 4, winner: false, incumbent: false },
    { name: `Trail ${id}`, party: "Republican", votes: 100 - lead, pct: 50 - lead / 4, winner: false, incumbent: false },
  ],
  ...over,
});

describe("closest races", () => {
  it("puts uncalled toss-ups first, each group closest first", () => {
    const list = [race(1, 1, { rating: "lean-r" }), race(2, 9, { rating: "tossup" }), race(3, 2), race(4, 4, { rating: "tossup" })].sort(closestFirst);
    expect(list.map((r) => r.id)).toEqual([4, 2, 1, 3]);
  });

  it("lets a called toss-up fall back into the regular order", () => {
    const open = race(2, 9, { rating: "tossup" });
    const called = { ...open, candidates: open.candidates.map((c, i) => ({ ...c, winner: i === 0 })) };
    expect([called, race(1, 1)].sort(closestFirst).map((r) => r.id)).toEqual([1, 2]);
  });
});
