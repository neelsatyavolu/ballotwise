import { describe, expect, it } from "vitest";
import { chamberViews, type Forecast } from "../lib/midterms/forecast";
import { countChance, liveOdds, nationalSwing, projectChambers } from "../lib/midterms/liveProjection";
import { chamberEntries } from "../lib/midterms/seats";
import type { RaceSummary } from "../lib/midterms/view";

let nextId = 1;
/** A Democrat-vs-Republican race with the forecast giving the Democrat `pD`, and `votes` counted with `reporting`% in. */
function race(office: RaceSummary["office"], pD: number, count: { votes?: [number, number]; reporting?: number; winner?: "D" | "R" } = {}): RaceSummary {
  const [d, r] = count.votes ?? [0, 0];
  const forecast = { odds: { D: pD, R: 1 - pD }, sigma: 8 } as unknown as Forecast;
  return {
    id: nextId++,
    office,
    state: "PA",
    district: office === "house" ? nextId : null,
    title: "Race",
    reporting: count.reporting ?? 0,
    total: d + r,
    candidates: [
      { name: "Dana Dem", party: "Democratic", votes: d, pct: d + r ? (d / (d + r)) * 100 : 0, winner: count.winner === "D", incumbent: false },
      { name: "Rob Rep", party: "Republican", votes: r, pct: d + r ? (r / (d + r)) * 100 : 0, winner: count.winner === "R", incumbent: false },
    ],
    rating: null,
    signal: { market: null, polls: null, rating: null, forecast },
  };
}

describe("live projection", () => {
  it("keeps the forecast for a race with no votes, and settles a called one", () => {
    expect(liveOdds(race("senate", 0.6), 0)).toEqual({ D: 0.6, R: 0.4 });
    expect(liveOdds(race("senate", 0.6, { votes: [40, 60], reporting: 100, winner: "R" }), 0)).toEqual({ R: 1 });
  });

  it("trusts a count more as more of it is reported", () => {
    // Democrat favored at 60%, trailing by 4 points.
    const early = countChance(race("senate", 0.6, { votes: [48, 52], reporting: 5 }))!;
    const late = countChance(race("senate", 0.6, { votes: [48, 52], reporting: 97 }))!;
    expect(early.lead).toBe("R");
    // Early on the forecast still dominates: the trailing Democrat stays near even.
    expect(early.p).toBeLessThan(0.55);
    expect(late.p).toBeGreaterThan(0.95);
  });

  it("gives a clear lead at half counted most of the say against a forecast that disagreed", () => {
    // Forecast 32% for the Democrat, who leads by 7.8 with 54% in (as OH-7 in a mock night).
    const r = race("house", 0.321, { votes: [5390, 4610], reporting: 54 });
    const c = countChance(r)!;
    expect(c.lead).toBe("D");
    expect(c.p).toBeGreaterThan(0.55);
    expect(c.p).toBeLessThan(0.75);
  });

  it("matches the published forecast before any votes", () => {
    const races = [race("senate", 0.5), race("senate", 0.7), race("house", 0.3), race("house", 0.55), race("governor", 0.45)];
    const published = chamberViews(chamberEntries(races, (r) => r.signal?.forecast ?? null), 2000);
    const live = projectChambers(races, 2000);
    expect(live.swing).toBe(0);
    expect(live.chambers.senate.dControl).toBe(published.senate.dControl);
    expect(live.chambers.house.dSeats).toBe(published.house.dSeats);
  });

  it("moves races with no votes by how far well-counted races beat their forecast", () => {
    // Twenty races where Democrats were expected to lose by about 2 points but lead by 6 with 90% in.
    const counted = Array.from({ length: 20 }, () => race("house", 0.4, { votes: [53, 47], reporting: 90 }));
    const swing = nationalSwing(counted);
    expect(swing).toBeGreaterThan(0.3);
    const waiting = race("house", 0.5);
    expect(liveOdds(waiting, swing)!.D).toBeGreaterThan(0.6);
    // A handful of half-counted races barely moves it.
    expect(nationalSwing(counted.slice(0, 2))).toBeLessThan(swing / 3);
  });

  it("counts called races as won and lists the undecided ones nearest a coin flip first", () => {
    const races = [race("senate", 0.9, { votes: [60, 40], reporting: 100, winner: "D" }), race("senate", 0.52), race("senate", 0.95), race("senate", 0.3, { votes: [45, 55], reporting: 40 })];
    const senate = projectChambers(races, 1000).chambers.senate;
    expect(senate.won).toEqual({ D: 1, R: 0 });
    expect(senate.counting).toBe(1);
    expect(senate.waiting).toBe(2);
    expect(senate.close[0].id).toBe(races[1].id);
    expect(senate.close.at(-1)!.id).toBe(races[2].id);
  });
});
