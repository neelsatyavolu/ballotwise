import { describe, expect, it } from "vitest";
import type { CountyResult, RaceDetail } from "../lib/midterms/races";
import { CONTESTED_TURNOUT, MIDTERM_TURNOUT, votesLeft } from "../lib/midterms/votesLeft";

const county = (name: string, d: number, r: number, reporting: number, pres?: [number, number, number]): CountyResult => ({
  fips: null,
  name,
  reporting,
  total: d + r,
  candidates: [
    { name: "Dee", party: "Democratic", votes: d, pct: 0 },
    { name: "Arr", party: "Republican", votes: r, pct: 0 },
  ],
  baseline2024: null,
  pres2024: pres ? { harris: pres[0], trump: pres[1], total: pres[2] } : null,
});

function race(counties: CountyResult[], over: Partial<RaceDetail> = {}): RaceDetail {
  const d = counties.reduce((s, c) => s + c.candidates[0].votes, 0);
  const r = counties.reduce((s, c) => s + c.candidates[1].votes, 0);
  return {
    id: 1, office: "senate", state: "GA", district: null, title: "Georgia US Senate", reporting: 50, total: d + r, rating: null, signal: null,
    candidates: [
      { name: "Arr", party: "Republican", votes: r, pct: 0, winner: false, incumbent: false },
      { name: "Dee", party: "Democratic", votes: d, pct: 0, winner: false, incumbent: false },
    ],
    pollsClose: null, updated: null, counties, ...over,
  } as RaceDetail;
}

describe("votesLeft", () => {
  it("scales each county's count by its reporting and splits what's left the way the county is voting", () => {
    // City: 80/20 D at half counted, so 100 more, 80 D. Rural: 30/70 at 75%, so 100 more, 30 D.
    const est = votesLeft(race([county("City", 80, 20, 50), county("Rural", 90, 210, 75)]))!;
    expect(est.left).toBe(200);
    expect(est.leader).toMatchObject({ name: "Arr", votes: 90 });
    expect(est.runnerUp).toMatchObject({ name: "Dee", votes: 110 });
    expect(est.places.map((p) => p.name)).toEqual(["City", "Rural"]);
    expect(est.places[0].edge).toBeCloseTo(-60);
  });

  it("takes DDHQ's expected vote over both guesses where a connected account has it, and nothing from a finished county", () => {
    // City: DDHQ expects 400 and 100 are counted (its precinct share says half, which would give 100 more). Rural: done.
    const est = votesLeft(race([{ ...county("City", 80, 20, 50), expected: 400 }, { ...county("Rural", 90, 210, 40), expected: 900, done: true }]))!;
    expect(est.left).toBe(300);
    expect(est.places.map((p) => p.name)).toEqual(["City"]);
    // Counted past DDHQ's estimate: nothing left rather than less than nothing.
    expect(votesLeft(race([{ ...county("City", 80, 20, 50), expected: 90 }, { ...county("Rural", 90, 210, 40), expected: 300 }]))).toMatchObject({ left: 0 });
  });

  it("starts a quiet county at its 2024 vote times the turnout so far, in its 2024 lean moved by the swing", () => {
    // Counted: 2024 was even, now 60/40 at half its precincts, a 20-point swing to Dee. Quiet: 2024 was 50/25, so 60/15.
    const est = votesLeft(race([county("Counted", 60, 40, 50, [200, 200, 400]), county("Quiet", 0, 0, 0, [400, 200, 800])]))!;
    // Turnout: Counted's scaled-up 200 against 400 in 2024, weighed at an eighth, and the usual midterm turnout at 60.
    const turnout = (0.125 * 200 + 60 * MIDTERM_TURNOUT) / (0.125 * 400 + 60);
    // Counted: the scaled-up 100 more at an eighth's weight, its 2024 vote at that turnout less the 100 counted at the rest.
    const counted = 0.125 * 100 + 0.875 * (400 * turnout - 100);
    const quiet = 800 * turnout;
    expect(est.left).toBe(Math.round(quiet + counted));
    expect(est.leader).toMatchObject({ name: "Dee", votes: Math.round(quiet * 0.6 + counted * 0.6) });
    expect(est.runnerUp).toMatchObject({ name: "Arr", votes: Math.round(quiet * 0.15 + counted * 0.4) });
    expect(est.unknown).toBe(0);
  });

  it("moves turnout toward what the finished counties show", () => {
    // Done: half its 2024 vote, outweighing the usual midterm turnout (weighed at 5% of the state's 2024 vote).
    const est = votesLeft(race([county("Done", 2500, 2500, 100, [5000, 5000, 10_000]), county("Quiet", 0, 0, 0, [400, 400, 800])]))!;
    const k = 10_800 * 0.05;
    expect(est.left).toBe(Math.round((800 * (5000 + k * MIDTERM_TURNOUT)) / (10_000 + k)));
  });

  it("starts a rated race at the higher turnout of a contested state", () => {
    const quiet = [county("Done", 50, 50, 100), county("Quiet", 0, 0, 0, [400, 400, 1000])];
    expect(votesLeft(race(quiet))!.left).toBe(Math.round(1000 * MIDTERM_TURNOUT));
    expect(votesLeft(race(quiet, { rating: "tossup" }))!.left).toBe(Math.round(1000 * CONTESTED_TURNOUT));
  });

  it("doesn't scale up a county that counted its mail before its precincts", () => {
    // 600 counted with 2% of precincts in: scaled up that's 30,000, against about 1000 × turnout expected from 2024.
    const est = votesLeft(race([county("Mail first", 300, 300, 2, [500, 500, 1000]), county("Done", 50, 50, 100)]))!;
    const expected = 1000 * MIDTERM_TURNOUT - 600;
    expect(est.left).toBeGreaterThan(expected - 10);
    expect(est.left).toBeLessThan(expected + 25);
  });

  it("splits a mail-first county's remaining vote nearer its 2024 lean than its early count", () => {
    // Mail first: 70/30 with 2% of precincts in, even in 2024. Done: even then and now, so the state hasn't swung.
    const est = votesLeft(race([county("Mail first", 420, 180, 2, [500, 500, 1000]), county("Done", 500, 500, 100, [500, 500, 1000])]))!;
    const dee = est.leader.votes / est.left;
    // The count alone would hand Dee 70% of what's left; the mail's lean only partly carries over.
    expect(dee).toBeLessThan(0.66);
    expect(dee).toBeGreaterThan(0.5);
    expect(Math.abs(est.leader.votes + est.runnerUp.votes - est.left)).toBeLessThanOrEqual(1);
  });

  it("keeps a House county's own count shares, since only part of the county is in the district", () => {
    const est = votesLeft(race([county("Part", 70, 30, 50, [500, 500, 1000]), county("Other", 50, 50, 50)], { office: "house", district: 1 }))!;
    expect(est.leader.votes / est.left).toBeCloseTo((70 + 50) / 200, 2);
  });

  it("leaves out House counties with nothing counted, since a district covers only parts of them", () => {
    const est = votesLeft(race([county("Counted", 50, 50, 50, [200, 200, 400]), county("Quiet", 0, 0, 0, [600, 200, 800])], { office: "house", district: 1 }))!;
    expect(est.left).toBe(100);
    expect(est.unknown).toBe(1);
  });

  it("counts nothing left in a county at 100%, and has no estimate before votes or once called", () => {
    expect(votesLeft(race([county("Done", 10, 20, 100), county("Also", 5, 5, 100)]))!.left).toBe(0);
    expect(votesLeft(race([county("None", 0, 0, 0)]))).toBeNull();
    const called = race([county("City", 80, 20, 50), county("Rural", 90, 210, 75)]);
    expect(votesLeft({ ...called, candidates: called.candidates.map((c, i) => ({ ...c, winner: i === 0 })) })).toBeNull();
  });

  it("treats a race with no county breakdown as one region", () => {
    const est = votesLeft(race([], { reporting: 50, total: 200, candidates: [{ name: "Arr", party: "Republican", votes: 120, pct: 60, winner: false, incumbent: false }, { name: "Dee", party: "Democratic", votes: 80, pct: 40, winner: false, incumbent: false }] }))!;
    expect(est.left).toBe(200);
    expect(est.leader.votes).toBe(120);
  });
});
