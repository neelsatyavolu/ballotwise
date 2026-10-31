// A rough estimate of the vote still to count in a race, county by county, and how it might split.
import type { CountyResult, RaceDetail } from "./races";
import { partyOf } from "./view";

/** One of the two leading candidates and the votes they might get from what's left. */
export type Share = { name: string; party: string; votes: number };
/** A county with votes left, and the pick of the two leaders there (positive favors the race's leader), in points. */
export type Place = { name: string; left: number; edge: number | null };
export type VotesLeft = {
  /** Votes still to count, estimated. */
  left: number;
  /** The race's leader and runner-up, each with the votes they might get from what's left. */
  leader: Share;
  runnerUp: Share;
  /** The counties with the most left, most first. */
  places: Place[];
  /** Counties with nothing counted and no 2024 vote to go on, left out of the estimate. */
  unknown: number;
};

const PLACES = 3;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * How many votes a county will end with: its count scaled up by its reporting figure, or, with nothing counted, its
 * 2024 presidential vote at the turnout the counted counties show. A House district covers parts of counties, so
 * whole-county 2024 totals can't stand in there. Null when there's nothing to go on.
 */
function expectedOf(c: CountyResult, turnout: number | null, statewide: boolean): number | null {
  if (c.reporting >= 100) return c.total;
  if (c.total > 0 && c.reporting > 0 && !c.reportingUnknown) return (c.total * 100) / c.reporting;
  if (statewide && c.pres2024 && turnout !== null) return Math.max(c.total, c.pres2024.total * turnout);
  return null;
}

/** This year's vote against 2024's in the counties whose count can be scaled up, or null when none can. */
function turnoutOf(counties: readonly CountyResult[]): number | null {
  const scaled = counties.filter((c) => c.pres2024 && c.total > 0 && c.reporting > 0 && !c.reportingUnknown);
  const pres = sum(scaled.map((c) => c.pres2024!.total));
  return pres ? sum(scaled.map((c) => (c.total * 100) / Math.min(100, c.reporting))) / pres : null;
}

/**
 * The two leaders' shares of a county's remaining vote: their shares of its count so far, else their parties' shares
 * of its 2024 presidential vote, else their shares statewide.
 */
function sharesIn(c: CountyResult, names: readonly [string, string], parties: readonly [string, string], statewide: readonly [number, number]): [number, number] {
  if (c.total > 0) {
    const votes = names.map((n) => c.candidates.find((x) => x.name === n)?.votes ?? 0);
    return [votes[0] / c.total, votes[1] / c.total];
  }
  const p = c.pres2024;
  const side = parties.map(partyOf);
  if (p?.total && side.includes("D") && side.includes("R")) {
    const of = (s: string) => (s === "D" ? p.harris : s === "R" ? p.trump : 0) / p.total;
    return [of(side[0]), of(side[1])];
  }
  return [...statewide];
}

/**
 * Roughly how many votes are left in a race still counting and how they might split between the two leaders, from each
 * county's count, reporting figure and 2024 vote. civicAPI's reporting figure counts precincts or ballot batches, not
 * ballots, and late mail can lean differently, so it's an estimate to read loosely. Null before any votes, once
 * called, or with fewer than two candidates.
 */
export function votesLeft(race: RaceDetail): VotesLeft | null {
  const [a, b] = [...race.candidates].sort((x, y) => y.votes - x.votes);
  if (!a || !b || race.total <= 0 || race.candidates.some((c) => c.winner)) return null;
  const statewide = race.office !== "house";
  const names = [a.name, b.name] as const;
  const parties = [a.party, b.party] as const;
  const overall: [number, number] = [a.votes / race.total, b.votes / race.total];
  // One region, or none, is the race itself.
  const counties: readonly CountyResult[] = race.counties.length > 1 ? race.counties : [{ fips: null, name: race.title, reporting: race.reporting, total: race.total, candidates: race.candidates, ...(race.reportingUnknown && { reportingUnknown: true as const }), baseline2024: null, pres2024: null }];
  const turnout = statewide ? turnoutOf(counties) : null;
  const estimated = counties.map((c) => ({ c, expected: expectedOf(c, turnout, statewide) }));
  const rows = estimated.flatMap(({ c, expected }) => {
    if (expected === null) return [];
    const left = Math.max(0, expected - c.total);
    if (!left) return [];
    const [sa, sb] = sharesIn(c, names, parties, overall);
    return [{ name: c.name, left, a: left * sa, b: left * sb, edge: sa + sb > 0 ? (sa - sb) * 100 : null }];
  });
  return {
    left: Math.round(sum(rows.map((r) => r.left))),
    leader: { name: a.name, party: a.party, votes: Math.round(sum(rows.map((r) => r.a))) },
    runnerUp: { name: b.name, party: b.party, votes: Math.round(sum(rows.map((r) => r.b))) },
    places: rows
      .sort((x, y) => y.left - x.left)
      .slice(0, PLACES)
      .map((r) => ({ name: r.name, left: Math.round(r.left), edge: r.edge })),
    unknown: estimated.filter((e) => e.expected === null).length,
  };
}
