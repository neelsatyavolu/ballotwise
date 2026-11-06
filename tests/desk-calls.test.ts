import { describe, expect, it } from "vitest";
import { withDeskCalls, withDeskSeats } from "../lib/midterms/deskCalls";
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
    // A race our call log holds takes DDHQ's call.
    expect(withDeskCalls([race({ callPending: true })], winners)[0]).toMatchObject({ calledFor: "Terri A. Sewall", callPending: undefined });
    const unknown = race({ candidates: [{ name: "X Y", party: "Independent", votes: 1, pct: 50, winner: false, incumbent: false }, { name: "Z W", party: "Independent", votes: 1, pct: 50, winner: false, incumbent: false }] });
    expect(withDeskCalls([unknown], winners)[0]).toBe(unknown);
    const twins = [race({ id: 1 }), race({ id: 2 })];
    expect(withDeskCalls(twins, winners).every((r) => !r.calledFor)).toBe(true);
    expect(withDeskCalls([race({})], undefined)[0].calledFor).toBeUndefined();
  });

  it("matches names across accents and hyphens, even with two candidates of the winner's party", () => {
    const two = race({ district: 37, candidates: [{ name: "Sydney Kamlager-Dove", party: "Democratic", votes: 70, pct: 70, winner: false, incumbent: true }, { name: "Samantha Mota", party: "Democratic", votes: 30, pct: 30, winner: false, incumbent: false }] });
    expect(withDeskCalls([two], { "house:AL:37": { name: "Sydney Kamlager Dove", side: "D", at: 5 } })[0].calledFor).toBe("Sydney Kamlager-Dove");
    const md = race({ district: 6, candidates: [{ name: "April McClain Delaney", party: "Democratic", votes: 70, pct: 70, winner: false, incumbent: true }, { name: "Robin Ficker", party: "Republican", votes: 30, pct: 30, winner: false, incumbent: false }] });
    expect(withDeskCalls([md], { "house:AL:6": { name: "April McClain-Delaney", side: "D", at: 5 } })[0].calledFor).toBe("April McClain Delaney");
    const nm = race({ office: "senate", district: null, candidates: [{ name: "Ben Ray Luján", party: "Democratic", votes: 1, pct: 50, winner: false, incumbent: true }, { name: "Nella Domenici", party: "Republican", votes: 1, pct: 50, winner: false, incumbent: false }] });
    expect(withDeskCalls([nm], { "senate:AL:": { name: "Ben Ray Lujan", side: "D", at: 5 } })[0].calledFor).toBe("Ben Ray Luján");
  });

  it("matches by party when the names differ", () => {
    const [r] = withDeskCalls([race({ candidates: [{ name: "Terri Sewall-Jones", party: "Democratic", votes: 70, pct: 70, winner: false, incumbent: true }, { name: "Ammie Akin", party: "Republican", votes: 30, pct: 30, winner: false, incumbent: false }] })], winners);
    expect(r.calledFor).toBe("Terri Sewall-Jones");
  });
});

describe("withDeskSeats", () => {
  const tally = (D: number, R: number) => ({ D, R, other: 0, total: 435, majority: 218, uncalled: 435 - D - R });
  const b = { house: tally(205, 116), senate: { ...tally(51, 40), total: 100, majority: 51 }, governor: { ...tally(20, 20), total: 50, majority: 26 } };

  it("takes DDHQ's own House and Senate counts, and keeps them through a later recount", () => {
    const desk = withDeskSeats(b, { house: { D: 211, R: 117, other: 0 } });
    expect(desk.house).toMatchObject({ D: 211, R: 117, total: 435, source: "ddhq" });
    expect(desk.senate).toEqual(b.senate);
    expect(desk.governor).toEqual(b.governor);
    // A connected screen recounts from its own races; DDHQ's count carries over.
    expect(withDeskSeats(b, undefined, desk).house).toMatchObject({ D: 211, R: 117 });
    expect(withDeskSeats(b, undefined, b).house).toEqual(b.house);
  });

  it("carries the races called here that DDHQ's count doesn't have yet, so the seat bar can count them as leading", () => {
    const desk = withDeskSeats(b, { house: { D: 205, R: 114, other: 0 } });
    expect(desk.house.calledHere).toEqual({ D: 0, R: 2, other: 0 });
    // After a recount, the gap is measured against the new count.
    expect(withDeskSeats({ ...b, house: tally(206, 115) }, undefined, desk).house.calledHere).toEqual({ D: 1, R: 1, other: 0 });
  });
});
