import { describe, expect, it } from "vitest";
import { autoScale, nextScale, tourRaces, tourStops } from "../lib/midterms/wall";
import type { RaceSummary } from "../lib/midterms/view";

let nextId = 1;
function race(over: Partial<RaceSummary> & { votes?: [number, number]; winner?: 0 | 1 } = {}): RaceSummary {
  const [d, r] = over.votes ?? [0, 0];
  const total = d + r;
  const cands = [
    { name: "Dana Dem", party: "Democratic", votes: d, pct: total ? (d / total) * 100 : 0, winner: over.winner === 0, incumbent: false },
    { name: "Rob Rep", party: "Republican", votes: r, pct: total ? (r / total) * 100 : 0, winner: over.winner === 1, incumbent: false },
  ].sort((a, b) => b.votes - a.votes);
  return { id: nextId++, office: "senate", state: "GA", district: null, title: "Georgia US Senate", reporting: total ? 50 : 0, total, candidates: cands, rating: null, signal: null, ...over };
}

describe("wall tour", () => {
  it("visits this office's uncalled toss-ups and leans, closest first, and skips safe or called races", () => {
    const tossup = race({ rating: "tossup", votes: [50, 49] });
    const lean = race({ rating: "lean-r", votes: [40, 60] });
    const safe = race({ rating: "likely-d" });
    const called = race({ rating: "tossup", votes: [60, 40], winner: 0 });
    const house = race({ office: "house", rating: "tossup" });
    expect(tourRaces([safe, lean, called, house, tossup], "senate").map((r: RaceSummary) => r.id)).toEqual([tossup.id, lean.id]);
  });

  it("tours the closest counted races once every close one is called", () => {
    const close = race({ rating: "tossup", votes: [51, 49], winner: 0 });
    const wide = race({ rating: "likely-d", votes: [70, 30], winner: 0 });
    const uncounted = race({ rating: "likely-r" });
    expect(tourRaces([wide, uncounted, close], "senate").map((r: RaceSummary) => r.id)).toEqual([close.id, wide.id]);
  });

  it("caps the tour so a big night still comes back around", () => {
    const many = Array.from({ length: 30 }, () => race({ office: "house", rating: "tossup" }));
    expect(tourRaces(many, "house")).toHaveLength(12);
  });

  it("starts on the whole map and returns to it after every few races", () => {
    expect(tourStops([1, 2, 3, 4, 5])).toEqual([null, 1, 2, 3, null, 4, 5]);
    expect(tourStops([])).toEqual([null]);
  });
});

describe("wall scale", () => {
  it("grows type with the screen's width, within limits", () => {
    expect(autoScale(1280)).toBe(1);
    expect(autoScale(1920)).toBe(1.2);
    expect(autoScale(3840)).toBe(2.4);
    expect(autoScale(10_000)).toBe(3);
  });

  it("steps the viewer's adjustment in tenths and never shrinks below half size", () => {
    expect(nextScale(1, "+")).toBe(1.1);
    expect(nextScale(1.2, "-")).toBe(1.1);
    expect(nextScale(0.5, "-")).toBe(0.5);
    expect(nextScale(1.7, "0")).toBe(1);
  });
});
