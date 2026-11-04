import { describe, expect, it } from "vitest";
import { autoScale, nextScale, TOUR, tourRaces, tourStops } from "../lib/midterms/wall";
import type { RaceSummary } from "../lib/midterms/view";
import { likelyFlip, watchFirst } from "../lib/midterms/explore";

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

  it("tours the called toss-ups and leans once every one is called, the Senate never a safer race", () => {
    const close = race({ rating: "tossup", votes: [51, 49], winner: 0 });
    const wide = race({ rating: "likely-d", votes: [70, 30], winner: 0 });
    const uncounted = race({ rating: "likely-r" });
    expect(tourRaces([wide, uncounted, close], "senate").map((r: RaceSummary) => r.id)).toEqual([close.id]);
    // The House's still falls back to the closest counted races of any kind.
    const house = (over: Parameters<typeof race>[0]) => race({ office: "house", ...over });
    const hClose = house({ rating: "tossup", votes: [51, 49], winner: 0 });
    const hWide = house({ rating: "likely-d", votes: [70, 30], winner: 0 });
    expect(tourRaces([hWide, hClose], "house").map((r: RaceSummary) => r.id)).toEqual([hClose.id, hWide.id]);
  });

  it("puts toss-ups that look set to flip ahead of the other toss-ups, closer or not", () => {
    // Georgia's Senate seat is the Democrats'.
    const holding = race({ rating: "tossup", votes: [50, 49] });
    const flipping = race({ rating: "tossup", votes: [44, 56] });
    const lean = race({ rating: "lean-r", votes: [49, 51] });
    expect(likelyFlip(flipping)).toBe(true);
    expect(likelyFlip(holding)).toBe(false);
    expect(tourRaces([lean, holding, flipping], "senate").map((r: RaceSummary) => r.id)).toEqual([flipping.id, holding.id, lean.id]);
    expect([lean, holding, flipping].sort(watchFirst).map((r) => r.id)).toEqual([flipping.id, holding.id, lean.id]);
    // Before votes, a toss-up flips when the forecast favors the challenger's party.
    const forecast = (d: number) => ({ market: null, polls: null, rating: null, forecast: { odds: { D: d, R: 1 - d } } }) as unknown as RaceSummary["signal"];
    expect(likelyFlip(race({ rating: "tossup", signal: forecast(0.45) }))).toBe(true);
    expect(likelyFlip(race({ rating: "tossup", signal: forecast(0.55) }))).toBe(false);
    // Called, or not a toss-up: not on the list.
    expect(likelyFlip(race({ rating: "tossup", votes: [44, 56], winner: 1 }))).toBe(false);
    expect(likelyFlip(race({ rating: "lean-r", votes: [44, 56] }))).toBe(false);
  });

  it("goes only where votes are being counted, never to a race with no results yet", () => {
    const waiting = race({ rating: "tossup" });
    const countingLean = race({ rating: "lean-r", votes: [48, 52] });
    const countingSafe = race({ votes: [40, 60] });
    // The Senate's tour is only toss-ups and leans; the House's goes on to other counting races.
    expect(tourRaces([waiting, countingSafe, countingLean], "senate").map((r: RaceSummary) => r.id)).toEqual([countingLean.id]);
    const hLean = race({ office: "house", rating: "lean-r", votes: [48, 52] });
    const hSafe = race({ office: "house", votes: [40, 60] });
    expect(tourRaces([hSafe, hLean], "house").map((r: RaceSummary) => r.id)).toEqual([hLean.id, hSafe.id]);
    // Nothing counted anywhere: no stops, so the map stays on the whole country.
    expect(tourRaces([waiting, race({ rating: "lean-d" })], "senate")).toEqual([]);
  });

  it("caps the tour so a big night still comes back around", () => {
    const many = Array.from({ length: 30 }, () => race({ office: "house", rating: "tossup", votes: [50, 49] }));
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

  it("takes the House from the whole country into the three races its up-next cards show", () => {
    expect(TOUR.house.racesPerLeg).toBe(3);
    expect(tourStops([1, 2, 3, 4], TOUR.house.racesPerLeg)).toEqual([null, 1, 2, 3, null, 4]);
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
