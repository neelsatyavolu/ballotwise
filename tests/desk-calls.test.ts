import { describe, expect, it } from "vitest";
import { withDeskCalls } from "../lib/midterms/deskCalls";
import type { RaceSummary } from "../lib/midterms/view";

const race = (over: Partial<RaceSummary>): RaceSummary => ({
  id: 1, office: "house", state: "AL", district: 7, title: "Alabama US House 7", reporting: 80, total: 100, rating: null,
  candidates: [
    { name: "Terri A. Sewall", party: "Democratic", votes: 70, pct: 70, winner: false, incumbent: true },
    { name: "Ammie Akin", party: "Republican", votes: 30, pct: 30, winner: false, incumbent: false },
  ],
  ...over,
});

describe("withDeskCalls", () => {
  const winners = { "house:AL:7": { name: "Terri Sewall", side: "D" as const, at: 5 } };

  it("calls an uncalled race for DDHQ's winner, by last name", () => {
    const [r] = withDeskCalls([race({})], winners);
    expect(r.calledFor).toBe("Terri A. Sewall");
    expect(r.candidates.find((c) => c.winner)?.name).toBe("Terri A. Sewall");
    expect(r.call).toMatchObject({ at: 5, winner: "Terri A. Sewall" });
  });

  it("leaves called, pending and unmatched races, and seats shared by two races, as they are", () => {
    const called = race({ calledFor: "Ammie Akin" });
    expect(withDeskCalls([called], winners)[0]).toBe(called);
    const pending = race({ callPending: true });
    expect(withDeskCalls([pending], winners)[0]).toBe(pending);
    const unknown = race({ candidates: [{ name: "X Y", party: "Independent", votes: 1, pct: 50, winner: false, incumbent: false }, { name: "Z W", party: "Independent", votes: 1, pct: 50, winner: false, incumbent: false }] });
    expect(withDeskCalls([unknown], winners)[0]).toBe(unknown);
    const twins = [race({ id: 1 }), race({ id: 2 })];
    expect(withDeskCalls(twins, winners).every((r) => !r.calledFor)).toBe(true);
    expect(withDeskCalls([race({})], undefined)[0].calledFor).toBeUndefined();
  });

  it("matches by party when the names differ", () => {
    const [r] = withDeskCalls([race({ candidates: [{ name: "Terri Sewall-Jones", party: "Democratic", votes: 70, pct: 70, winner: false, incumbent: true }, { name: "Ammie Akin", party: "Republican", votes: 30, pct: 30, winner: false, incumbent: false }] })], winners);
    expect(r.calledFor).toBe("Terri Sewall-Jones");
  });
});
