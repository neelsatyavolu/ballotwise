import { describe, expect, it } from "vitest";
import { deskSeats, deskView } from "../lib/ddhq/live";
import type { DdhqRace } from "../lib/ddhq/votes";
import { balance, type RaceSummary } from "../lib/midterms/races";
import type { Overview } from "../lib/midterms/view";

function race(overrides: Partial<RaceSummary>): RaceSummary {
  return {
    id: 1, state: "GA", office: "senate", district: null, title: "US Senate", total: 100, reporting: 10, calledFor: null, rating: null,
    candidates: [
      { name: "Dana Old", party: "Democratic", votes: 60, pct: 60, winner: false, incumbent: true },
      { name: "Riley Old", party: "Republican", votes: 40, pct: 40, winner: false, incumbent: false },
    ],
    ...overrides,
  };
}

const called: DdhqRace = {
  forecast: [], rating: null, updatedAt: 20, call: { name: "Dana Old", at: "2026-11-04T03:00:00Z" }, counties: [], total: 5000, reporting: 90, expected: 5500,
  candidates: [
    { name: "Dana Old", party: "Democratic", votes: 3000, pct: 60, winner: true, incumbent: true },
    { name: "Riley Old", party: "Republican", votes: 2000, pct: 40, winner: false, incumbent: false },
  ],
};

describe("deskSeats", () => {
  it("asks for Senate, House and governor seats once each, leaving out measures and local races", () => {
    const seats = deskSeats([
      race({ id: 1 }),
      race({ id: 2, title: "US Senate Special" }),
      race({ id: 3, office: "house", district: 7, title: "US House GA-7" }),
      race({ id: 4, office: "house", district: 7, title: "US House GA-7" }),
      race({ id: 5, office: "measure", title: "Amendment 1" }),
      race({ id: 6, office: "governor", title: "Governor", local: { kind: "candidates", type: "Mayor", date: "2026-11-03" } }),
    ]);
    expect(seats).toEqual([
      { state: "GA", office: "senate", district: null, special: false },
      { state: "GA", office: "senate", district: null, special: true },
      { state: "GA", office: "house", district: 7, special: false },
    ]);
  });
});

describe("deskView", () => {
  it("lays DDHQ's count and call over the overview, the way the website does", () => {
    const r = race({});
    const overview: Overview = { races: [r], balance: balance([r]), fetchedAt: 10, stale: false, ratings: { updatedAt: 10 }, callEvents: [], callEventCounts: { senate: 0, house: 0, governor: 0, measure: 0 } };
    const out = deskView("/api/midterms", overview, [{ key: "senate:GA::g", race: called }, { key: "senate:NC::g", race: null }]);
    expect(out.races[0].total).toBe(5000);
    expect(out.races[0].candidates[0].winner).toBe(true);
    expect(out.balance.senate.D).toBe(overview.balance.senate.D + 1);
  });

  it("leaves the payload alone when DDHQ has nothing", () => {
    const r = race({});
    const body = { race: r, fetchedAt: 10, stale: false };
    expect(deskView("/api/midterms/race/1", body, [])).toBe(body);
  });
});
