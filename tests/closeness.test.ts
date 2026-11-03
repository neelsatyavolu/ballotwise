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
  it("puts counting toss-ups and leans first, then other counting races, each closest first", () => {
    const list = [race(1, 1, { rating: "lean-r" }), race(2, 9, { rating: "tossup" }), race(3, 2), race(4, 4, { rating: "tossup" })].sort(closestFirst);
    expect(list.map((r) => r.id)).toEqual([1, 4, 2, 3]);
  });

  it("puts called races after the ones still counting, and races with no votes last", () => {
    const open = race(2, 9, { rating: "tossup" });
    const called = { ...open, candidates: open.candidates.map((c, i) => ({ ...c, winner: i === 0 })) };
    const waiting = { ...race(5, 0, { rating: "tossup" }), total: 0, reporting: 0, candidates: open.candidates.map((c) => ({ ...c, votes: 0, pct: 0 })) };
    expect([waiting, race(1, 1), called, race(3, 12, { rating: "tossup" })].sort(closestFirst).map((r) => r.id)).toEqual([3, 1, 2, 5]);
  });
});
