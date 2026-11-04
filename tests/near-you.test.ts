import { describe, expect, it } from "vitest";
import { trackedAt } from "../lib/midterms/nearYou";
import type { RaceSummary } from "../lib/midterms/races";
import { seatGap } from "../lib/midterms/view";

const prop = (id: number, total: number, winner: "Yes" | "No" | null): RaceSummary => ({
  id,
  office: "measure",
  state: "CA",
  district: null,
  title: `California Proposition ${id}`,
  reporting: 50,
  total,
  rating: null,
  candidates: [
    { name: "Yes", party: "Nonpartisan", votes: total * 0.6, pct: 60, winner: winner === "Yes", incumbent: false },
    { name: "No", party: "Nonpartisan", votes: total * 0.4, pct: 40, winner: winner === "No", incumbent: false },
  ],
});

const local = (measures: RaceSummary[]) => ({ area: "Palo Alto", state: "CA", countyFips: "06085", house: 16, legislature: [], yours: [], nearby: [], source: "county" as const, measures });

describe("trackedAt's statewide measures", () => {
  it("takes Decision Desk HQ's bigger count but keeps our own call", () => {
    // DDHQ has called Prop 1 and we haven't; we've called Prop 39 and DDHQ hasn't.
    const ours = [prop(1, 100, null), prop(39, 100, "No")];
    const ddhq = [prop(1, 200, "Yes"), prop(39, 200, null)];
    const { measures } = trackedAt(local(ddhq), ours);
    expect(measures.map((m) => [m.id, m.total, m.candidates.filter((c) => c.winner).map((c) => c.name)])).toEqual([
      [1, 200, []],
      [39, 200, ["No"]],
    ]);
  });
});

describe("seatGap", () => {
  const c = (name: string, votes: number) => ({ name, party: "Nonpartisan", votes, pct: 0 });
  it("measures a multi-seat race at its last seat: the last winner against the first one out", () => {
    // Palo Alto's council, 3 seats: Chang leads Veenker by 1.8 points, but Lauing holds the 3rd seat over Deng by 8.4.
    const council = [c("Veenker", 7382), c("Chang", 7971), c("Deng", 4561), c("Lauing", 7366), c("Hamachek", 3100), c("Etzkowitz", 3085)];
    expect(seatGap({ title: "City of Palo Alto Council, 3 seats", candidates: council })).toEqual({ seats: 3, holder: council[3], margin: expect.closeTo(8.4, 1) });
  });
  it("leaves a single-seat race to lead()", () => {
    expect(seatGap({ title: "Measure J", candidates: [c("Yes", 7005), c("No", 6681)] })).toBeNull();
  });
});
