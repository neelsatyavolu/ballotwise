import { describe, expect, it } from "vitest";
import { raceChance, unfinishedCount } from "../lib/midterms/raceChance";
import type { RaceDetail } from "../lib/midterms/races";
import type { VotesLeft } from "../lib/midterms/votesLeft";

const race = (d: number, r: number) =>
  ({
    total: d + r,
    candidates: [
      { name: "Dee", party: "Democratic", votes: d, pct: 0, winner: false, incumbent: false },
      { name: "Arr", party: "Republican", votes: r, pct: 0, winner: false, incumbent: false },
    ],
  }) as unknown as RaceDetail;
/** `dee` and `arr` votes left in one county with `counted` of its vote in. */
const left = (dee: number, arr: number, counted = 0.5): VotesLeft => ({
  left: dee + arr,
  leader: { name: "Dee", party: "Democratic", votes: dee },
  runnerUp: { name: "Arr", party: "Republican", votes: arr },
  places: [],
  unknown: 0,
  counties: [],
  breakdown: [{ left: dee + arr, net: dee - arr, counted }],
});

describe("raceChance", () => {
  it("projects the final margin from the lead and how the votes left split", () => {
    // Dee leads by 1,000 and the 10,000 left go 4,000-6,000 Arr: Arr nets 2,000 and finishes 1,000 ahead.
    const c = raceChance(race(50_000, 49_000), left(4_000, 6_000));
    expect(c.favorite.name).toBe("Arr");
    expect(c.margin).toBe(1_000);
    expect(c.chance).toBeGreaterThan(0.5);
    expect(c.chance).toBeLessThan(0.9);
  });

  it("is near certain once a lead is far bigger than the votes left could move", () => {
    expect(raceChance(race(60_000, 40_000), left(500, 500)).chance).toBeGreaterThan(0.99);
  });

  it("is a coin flip for a tie with an even split left", () => {
    expect(raceChance(race(50_000, 50_000), left(5_000, 5_000)).chance).toBeCloseTo(0.5);
  });

  it("is surer when the votes left are in counties nearly done counting, whose count says how the rest will go", () => {
    const late = raceChance(race(50_000, 49_000), left(5_000, 5_000, 0.95)).chance;
    const early = raceChance(race(50_000, 49_000), left(5_000, 5_000, 0.1)).chance;
    expect(late).toBeGreaterThan(early);
  });

  it("averages out independent county misses: the same votes left spread over many counties are surer than in one", () => {
    const one = raceChance(race(50_000, 49_000), left(5_000, 5_000)).chance;
    const spread = { ...left(5_000, 5_000), breakdown: Array.from({ length: 10 }, () => ({ left: 1_000, net: 0, counted: 0.5 })) };
    expect(raceChance(race(50_000, 49_000), spread).chance).toBeGreaterThan(one);
  });

  it("shows DDHQ Pulse's chance where DDHQ models the race, and ours where it doesn't", () => {
    const pulsed = raceChance(race(50_000, 49_500), left(5_000, 5_000), { side: "R", chance: 90 });
    expect(pulsed).toMatchObject({ pulse: true, favorite: { name: "Arr" } });
    expect(pulsed.chance).toBeCloseTo(0.9);
    // An independent's Pulse can't be read as either leader's chance.
    expect(raceChance(race(50_000, 49_500), left(5_000, 5_000), { side: "I", chance: 90 }).pulse).toBe(false);
  });

  it("is less sure with more votes left for the same projected margin", () => {
    const few = raceChance(race(50_000, 48_000), left(1_000, 1_000)).chance;
    const many = raceChance(race(50_000, 48_000), left(20_000, 20_000)).chance;
    expect(many).toBeLessThan(few);
  });

  it("projects a ranked-choice race's final round, moving each eliminated candidate's votes to the finalist of their party", () => {
    // Alaska's governor, Nov 5: the Democrat leads the first round, but the Republicans together outpoll him.
    const rcv = {
      rcv: true,
      total: 211_845,
      candidates: [
        { name: "Kay", party: "Democratic", votes: 104_046, pct: 0, winner: false, incumbent: false },
        { name: "Wil", party: "Republican", votes: 61_951, pct: 0, winner: false, incumbent: false },
        { name: "Bro", party: "Republican", votes: 30_054, pct: 0, winner: false, incumbent: false },
        { name: "Tay", party: "Republican", votes: 15_794, pct: 0, winner: false, incumbent: false },
      ],
    } as unknown as RaceDetail;
    const est: VotesLeft = { ...left(0, 0), left: 0, leader: { name: "Kay", party: "Democratic", votes: 0 }, runnerUp: { name: "Wil", party: "Republican", votes: 0 }, breakdown: [] };
    const c = raceChance(rcv, est);
    expect(c).toMatchObject({ rcv: true, favorite: { name: "Wil" } });
    expect(c.margin).toBe(61_951 + 30_054 + 15_794 - 104_046);
    // The transfers are a guess, so a lead from them isn't certain.
    expect(c.chance).toBeLessThan(0.99);
    // Without ranked choice the first round is the final count.
    expect(raceChance({ ...rcv, rcv: undefined } as RaceDetail, est).favorite.name).toBe("Kay");
    // Nor once the rounds have run.
    expect(raceChance({ ...rcv, round: 3 } as RaceDetail, est).rcv).toBe(false);
    // Nor when no other candidate shares a finalist's party (a write-in): the first round stands.
    const writeIn = { ...rcv, candidates: [rcv.candidates[0], rcv.candidates[1], { ...rcv.candidates[2], party: "Nonpartisan" }] } as RaceDetail;
    expect(raceChance(writeIn, est)).toMatchObject({ rcv: false, favorite: { name: "Kay" } });
  });

  it("splits a ranked-choice race's other votes left by their share of the count", () => {
    const rcv = {
      rcv: true,
      total: 100_000,
      candidates: [
        { name: "Dee", party: "Democratic", votes: 48_000, pct: 0, winner: false, incumbent: false },
        { name: "Arr", party: "Republican", votes: 46_000, pct: 0, winner: false, incumbent: false },
        { name: "Two", party: "Republican", votes: 6_000, pct: 0, winner: false, incumbent: false },
      ],
    } as unknown as RaceDetail;
    // 10,000 left: 4,800 Dee, 4,600 Arr, and the other 600 to Two, the rest of the race.
    const c = raceChance(rcv, { ...left(4_800, 4_600), left: 10_000 });
    expect(c.favorite.name).toBe("Arr");
    expect(c.margin).toBe(46_000 + 4_600 + 6_000 + 600 - 48_000 - 4_800);
  });

  it("calls a count with nothing estimated left unfinished unless DDHQ's expected vote says so", () => {
    // civicAPI's 100% counts precincts: California's uncalled House races still have mail to count.
    expect(unfinishedCount({}, { left: 0 })).toBe(true);
    expect(unfinishedCount({ expected: 300_000 }, { left: 0 })).toBe(false);
    expect(unfinishedCount({}, { left: 1_200 })).toBe(false);
  });
});
