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

  it("lists each mapped county's votes left and who they favor, for the map's Remaining view", () => {
    const est = votesLeft(race([{ ...county("City", 80, 20, 50), fips: "13121", expected: 400 }, { ...county("Rural", 30, 70, 50), fips: "13001", expected: 300 }, { ...county("Done", 5, 5, 100), fips: "13003" }]))!;
    expect(est.counties).toEqual([
      { fips: "13121", left: 300, party: "Democratic" },
      { fips: "13001", left: 200, party: "Republican" },
    ]);
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
    // The swing moves Quiet past its 2024 split (50/25) toward the full 20 points (60/15), weighed by how much of the
    // vote is in where it was read, so only partway.
    const q = est.places.find((p) => p.name === "Quiet")!;
    expect(q.edge!).toBeGreaterThan(25);
    expect(q.edge!).toBeLessThan(45);
    expect(est.leader.name).toBe("Dee");
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

  it("splits a House county's remaining vote toward its 2024 lean too, as only its shares (not its size) carry over", () => {
    // Part: 70/30 so far at half its precincts, even in 2024; Other: 50/50 with no 2024 vote to go on.
    const est = votesLeft(race([county("Part", 70, 30, 50, [500, 500, 1000]), county("Other", 50, 50, 50)], { office: "house", district: 1 }))!;
    // Part's 100 left: half the count's 70%, half its 2024 50%, so 60 to Dee; Other's 100 split 50/50.
    expect(est.leader.votes / est.left).toBeCloseTo((60 + 50) / 200, 2);
    // Only the counties' counts size what's left: a House district holds just part of each.
    expect(est.left).toBe(200);
  });

  it("starts each county from its own 2024 lean shifted to this year's forecast, so a city's vote still out leans its way", () => {
    // A city (2024 D+40) and a countryside (2024 R+40), the same size, both barely counted; the forecast has the race even.
    const forecast = { market: null, polls: null, rating: null, forecast: { odds: { D: 0.5, R: 0.5 }, left: "D", margin: 0 } } as unknown as RaceDetail["signal"];
    const est = votesLeft(race([county("City", 5, 5, 1, [7000, 3000, 10_000]), county("Country", 5, 5, 1, [3000, 7000, 10_000])], { signal: forecast }))!;
    // A place's edge is toward the race's leader; read it toward the Democrat.
    const dEdge = (name: string) => est.places.find((p) => p.name === name)!.edge! * (est.leader.name === "Dee" ? 1 : -1);
    expect(dEdge("City")).toBeGreaterThan(30);
    expect(dEdge("Country")).toBeLessThan(-30);
    // Shifted to the even forecast, the two cancel out.
    expect(Math.abs(est.leader.votes - est.runnerUp.votes) / est.left).toBeLessThan(0.05);
    // A forecast 10 points to the Democrat moves both counties that way.
    const leanD = { ...forecast, forecast: { ...forecast!.forecast!, odds: { D: 0.9, R: 0.1 }, margin: 10 } } as unknown as RaceDetail["signal"];
    const d10 = votesLeft(race([county("City", 5, 5, 1, [7000, 3000, 10_000]), county("Country", 5, 5, 1, [3000, 7000, 10_000])], { signal: leanD }))!;
    const deeShare = (d10.leader.name === "Dee" ? d10.leader.votes : d10.runnerUp.votes) / d10.left;
    expect(deeShare).toBeGreaterThan(0.53);
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

  it("matches a county's candidates by party when the race's names come from another source", () => {
    // DDHQ names the race's candidates its own way; civicAPI's counties keep theirs.
    const est = votesLeft(race([county("City", 80, 20, 50), county("Rural", 90, 210, 75)], { candidates: [
      { name: "Arr Smith", party: "Republican", votes: 300, pct: 0, winner: false, incumbent: false },
      { name: "D. Dee", party: "Democratic", votes: 170, pct: 0, winner: false, incumbent: false },
    ] }))!;
    expect(est.leader).toMatchObject({ name: "Arr Smith", votes: 90 });
    expect(est.runnerUp).toMatchObject({ name: "D. Dee", votes: 110 });
  });

  it("totals what's left to DDHQ's expected vote for the race, where a connected account has it, split as the counties would", () => {
    // The counties alone say 200 left (see the first test); DDHQ expects 1000 in all with 400 counted, so 600.
    const est = votesLeft(race([county("City", 80, 20, 50), county("Rural", 90, 210, 75)], { expected: 1000 }))!;
    expect(est.left).toBe(600);
    expect(est.leader.votes).toBe(270);
    expect(est.runnerUp.votes).toBe(330);
    expect(est.places[0]).toMatchObject({ name: "City", left: 300 });
    // With no county breakdown at all, the race's own shares split it.
    const bare = votesLeft(race([], { total: 200, expected: 500, candidates: [{ name: "Arr", party: "Republican", votes: 120, pct: 60, winner: false, incumbent: false }, { name: "Dee", party: "Democratic", votes: 80, pct: 40, winner: false, incumbent: false }] }))!;
    expect(bare).toMatchObject({ left: 300, leader: { votes: 180 }, runnerUp: { votes: 120 } });
    // Counted past DDHQ's statewide estimate, the counties' own estimates stand, as on DDHQ's map (Mississippi's
    // Senate race, Nov 5: 951,000 counted against a statewide 836,948, while 17 counties still had votes to come).
    const past = votesLeft(race([{ ...county("City", 80, 20, 50), expected: 160 }, { ...county("Rural", 90, 210, 75), expected: 250 }], { expected: 350 }))!;
    expect(past.left).toBe(60);
    expect(past.places.map((p) => p.name)).toEqual(["City"]);
  });

  it("leans on the race's forecast in a House race barely counted, not on its first batch", () => {
    // MI-4 on Nov 3: 1% in, the first batch 70/30, while the forecast had it near even (R+4).
    const forecast = { market: null, polls: null, rating: null, forecast: { odds: { D: 0.35, R: 0.65 }, left: "D", margin: -4 } } as unknown as RaceDetail["signal"];
    const est = votesLeft(race([county("Part", 70, 30, 1), county("Other", 0, 0, 0)], { office: "house", district: 4, signal: forecast }))!;
    const dee = (est.leader.name === "Dee" ? est.leader.votes : est.runnerUp.votes) / est.left;
    expect(dee).toBeGreaterThan(0.45);
    expect(dee).toBeLessThan(0.52);
    // Without a forecast, the count's own shares as before.
    const bare = votesLeft(race([county("Part", 70, 30, 1)], { office: "house", district: 4 }))!;
    expect((bare.leader.name === "Dee" ? bare.leader.votes : bare.runnerUp.votes) / bare.left).toBeCloseTo(0.7, 2);
  });

  it("barely moves uncounted counties by a swing read off a sliver of early mail", () => {
    // South Carolina on Nov 3: a county's first 2% came in 80/20 where 2024 was even, a 60-point swing on paper.
    const est = votesLeft(race([county("Mail", 800, 200, 2, [5000, 5000, 10_000]), county("Quiet", 0, 0, 0, [50_000, 50_000, 100_000])]))!;
    const quiet = est.places.find((p) => p.name === "Quiet")!;
    // The quiet county was even in 2024; a full swing would put it near 80/20.
    expect(Math.abs(quiet.edge!)).toBeLessThan(10);
  });

  it("never leaves a county more votes than its whole 2024 vote, however low its reporting figure", () => {
    // AZ-2, Nov 5: Gila 40% in with 19,686 counted, scaled up to ~29,000 more, against 27,648 votes in all in 2024.
    const est = votesLeft(race([county("Gila", 7_000, 12_686, 40.5, [8_000, 19_000, 27_648]), county("Apache", 15_000, 8_000, 100)], { office: "house", district: 2 }))!;
    expect(est.left).toBe(27_648 - 19_686);
  });

  it("keeps DDHQ's expected vote even past the county's 2024 vote", () => {
    const big = { ...county("Gila", 7_000, 12_686, 40.5, [8_000, 19_000, 27_648]), expected: 40_000 };
    expect(votesLeft(race([big, county("Apache", 15_000, 8_000, 100)], { office: "house", district: 2 }))!.left).toBe(40_000 - 19_686);
  });

  it("treats a race with no county breakdown as one region", () => {
    const est = votesLeft(race([], { reporting: 50, total: 200, candidates: [{ name: "Arr", party: "Republican", votes: 120, pct: 60, winner: false, incumbent: false }, { name: "Dee", party: "Democratic", votes: 80, pct: 40, winner: false, incumbent: false }] }))!;
    expect(est.left).toBe(200);
    expect(est.leader.votes).toBe(120);
  });
});
