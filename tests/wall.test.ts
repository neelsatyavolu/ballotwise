import { describe, expect, it } from "vitest";
import { autoScale, nextScale, TOUR, tourRaces, tourStops } from "../lib/midterms/wall";
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
    expect(tourStops([1, 2, 3, 4, 5], 3)).toEqual([null, 1, 2, 3, null, 4, 5]);
    expect(tourStops([1, 2], 1)).toEqual([null, 1, null, 2]);
    expect(tourStops([], 1)).toEqual([null]);
  });

  it("keeps the Senate's whole map up most of the time", () => {
    const { nationMs, raceMs, racesPerLeg } = TOUR.senate;
    expect(racesPerLeg).not.toBeNull();
    expect(nationMs / (nationMs + raceMs * racesPerLeg!)).toBeGreaterThan(0.6);
  });

  it("never leaves the House's whole map: its stops are only the featured races", () => {
    expect(TOUR.house.racesPerLeg).toBeNull();
    expect(tourStops([1, 2, 3], TOUR.house.racesPerLeg)).toEqual([1, 2, 3]);
    expect(tourStops([], TOUR.house.racesPerLeg)).toEqual([null]);
  });
});

describe("wall scale", () => {
  it("grows type with the screen, within limits", () => {
    expect(autoScale(1280, 1024)).toBe(1);
    expect(autoScale(1920, 1080)).toBe(1.2);
    expect(autoScale(3840, 2160)).toBe(2.4);
    expect(autoScale(10_000, 10_000)).toBe(3);
  });

  it("sizes an ultrawide by its height, so the wall isn't squashed into a strip", () => {
    expect(autoScale(3440, 1440)).toBe(1.6);
    expect(autoScale(2560, 1080)).toBe(1.2);
    expect(autoScale(5120, 1440)).toBe(1.6);
  });

  it("steps the viewer's adjustment in tenths and never shrinks below half size", () => {
    expect(nextScale(1, "+")).toBe(1.1);
    expect(nextScale(1.2, "-")).toBe(1.1);
    expect(nextScale(0.5, "-")).toBe(0.5);
    expect(nextScale(1.7, "0")).toBe(1);
  });
});
