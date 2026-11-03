import { describe, expect, it } from "vitest";
import { moments } from "../lib/midterms/moments";
import type { CallEvent, RaceSummary } from "../lib/midterms/view";

// Georgia's Senate seat is held by a Democrat, North Carolina's by a Republican (holders.json).
const race = (id: number, state: string, over: Partial<RaceSummary> = {}): RaceSummary => ({
  id,
  office: "senate",
  state,
  district: null,
  title: `${state} US Senate`,
  reporting: 80,
  total: 100,
  candidates: [],
  rating: null,
  ...over,
});
const event = (id: number, raceId: number, over: Partial<CallEvent> = {}): CallEvent => ({ id, raceId, office: "senate", kind: "call", winner: "Pat Lee", party: "Democratic", previous: null, at: 1000 + id, ...over });

function data(races: RaceSummary[], callEvents: CallEvent[]) {
  return { races, callEvents };
}

describe("election-night moments", () => {
  it("flags a toss-up or lean seat changing party", () => {
    const [m] = moments(data([race(1, "NC", { rating: "tossup" })], [event(1, 1, { winner: "Roy Cooper" })]));
    expect(m).toMatchObject({ key: "call:1", kicker: "D gain", side: "D", href: "/midterms/1" });
    expect(m.body).toBe("Roy Cooper (D) wins, taking the seat from Republicans.");
    expect(moments(data([race(1, "NC", { rating: "lean-r" })], [event(1, 1, { winner: "Roy Cooper" })]))).toHaveLength(1);
  });

  it("skips holds, safer seats, changed and withdrawn calls", () => {
    const list = moments(
      data([race(1, "GA", { rating: "tossup" }), race(2, "NC", { rating: "likely-r" }), race(3, "NC", { rating: "tossup" })], [
        event(1, 1),
        event(2, 2, { winner: "Roy Cooper" }),
        event(3, 3, { kind: "change", winner: "Roy Cooper" }),
        event(4, 3, { kind: "withdrawal", winner: null, party: null, previous: "Roy Cooper" }),
      ]),
    );
    expect(list).toEqual([]);
  });

  it("lists several flips newest first", () => {
    const list = moments(data([race(1, "NC", { rating: "tossup" }), race(2, "GA", { rating: "lean-d" })], [event(1, 1, { winner: "A" }), event(2, 2, { winner: "B", party: "Republican" })]));
    expect(list.map((m) => m.key)).toEqual(["call:2", "call:1"]);
  });

  it("ignores events for races the overview doesn't carry", () => {
    expect(moments(data([], [event(1, 7)]))).toEqual([]);
  });
});
