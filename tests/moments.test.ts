import { describe, expect, it } from "vitest";
import { moments, RANK } from "../lib/midterms/moments";
import type { CallEvent, Overview, RaceSummary, Tally } from "../lib/midterms/view";

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
const tally = (D: number, R: number, majority: number): Tally => ({ D, R, other: 0, total: D + R, majority, uncalled: 0 });
const quiet = { senate: tally(40, 40, 51), house: tally(100, 100, 218), governor: tally(10, 10, 26) };

function data(races: RaceSummary[], callEvents: CallEvent[], balance: Overview["balance"] = quiet) {
  return { races, callEvents, balance, fetchedAt: 9999 };
}

describe("election-night moments", () => {
  it("skips a routine call that holds a seat in an unstarred, uncontested race", () => {
    expect(moments(data([race(1, "GA")], [event(1, 1)]), new Set())).toEqual([]);
  });

  it("flags a seat changing party", () => {
    const [m] = moments(data([race(1, "NC")], [event(1, 1, { winner: "Roy Cooper" })]), new Set());
    expect(m).toMatchObject({ key: "call:1", rank: RANK.flip, kicker: "D gain", side: "D", href: "/midterms/1" });
    expect(m.body).toBe("Roy Cooper (D) wins, taking the seat from Republicans.");
  });

  it("flags changed and withdrawn calls", () => {
    const list = moments(
      data([race(1, "GA"), race(2, "NC")], [
        event(1, 1, { kind: "change", winner: "Mike Collins", party: "Republican", previous: "Jon Ossoff" }),
        event(2, 2, { kind: "withdrawal", winner: null, party: null, previous: "Roy Cooper" }),
      ]),
      new Set(),
    );
    expect(list.map((m) => m.kicker)).toEqual(["Call withdrawn", "Call changed"]);
    expect(list[1].body).toBe("Now called for Mike Collins (R), not Jon Ossoff.");
  });

  it("flags calls in starred races and toss-ups", () => {
    const list = moments(data([race(1, "GA"), race(2, "GA", { rating: "tossup" })], [event(1, 1), event(2, 2)]), new Set([1]));
    expect(list.map((m) => [m.key, m.kicker])).toEqual([
      ["call:1", "Your race is called"],
      ["call:2", "Toss-up called"],
    ]);
    expect(list[1].body).toBe("Pat Lee (D) wins, a D hold.");
  });

  it("announces chamber control once a side reaches the line, ahead of every call", () => {
    const balance = { ...quiet, senate: tally(49, 50, 51), house: tally(218, 190, 218) };
    const list = moments(data([race(1, "NC")], [event(1, 1)], balance), new Set());
    expect(list.map((m) => m.key)).toEqual(["control:senate:R", "control:house:D", "call:1"]);
    expect(list[0].title).toBe("Republicans win the Senate");
  });

  it("ignores events for races the overview doesn't carry", () => {
    expect(moments(data([], [event(1, 7, { kind: "change" })]), new Set())).toEqual([]);
  });
});
