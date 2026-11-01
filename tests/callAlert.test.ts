import { describe, expect, it } from "vitest";
import { callAlert } from "../lib/midterms/callAlert";
import type { CallEvent } from "../lib/midterms/calls";
import type { RaceSummary } from "../lib/midterms/races";

const georgia: RaceSummary = {
  id: 7, office: "senate", state: "GA", district: null, title: "Georgia US Senate", reporting: 90, total: 100, rating: "tossup",
  candidates: [
    { name: "Jon Ossoff", party: "Democratic", votes: 55, pct: 55, winner: true, incumbent: true },
    { name: "Mike Collins", party: "Republican", votes: 45, pct: 45, winner: false, incumbent: false },
  ],
};
const event = (over: Partial<CallEvent>): CallEvent => ({ id: 1, raceId: 7, office: "senate", kind: "call", winner: "Jon Ossoff", party: "Democratic", previous: null, at: 0, ...over });

describe("callAlert", () => {
  it("splits the phone alert's title into a kicker and the race, colored by the winner's party", () => {
    expect(callAlert(event({}), georgia)).toMatchObject({ id: 1, raceId: 7, kicker: "Called", label: "Georgia Senate", side: "D" });
  });

  it("marks a withdrawal with no party", () => {
    const a = callAlert(event({ kind: "withdrawal", winner: null, party: null, previous: "Jon Ossoff" }), georgia);
    expect(a).toMatchObject({ kicker: "Call withdrawn", side: null });
    expect(a.body).toContain("Jon Ossoff");
  });

  it("still says something when the race isn't in the catalog", () => {
    expect(callAlert(event({}), undefined)).toMatchObject({ kicker: "Called", label: "A race" });
  });
});
