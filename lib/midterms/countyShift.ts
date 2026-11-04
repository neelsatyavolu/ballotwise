// The race maps' Margin and Swing views, as DDHQ's county map has them: each county's raw vote lead, and how far it
// has moved from the 2024 presidential vote.
import type { CountyResult, RaceDetail } from "./races";
import { partyOf } from "./view";

type Cand = { name: string; party: string; votes: number };

/** One county's lead in votes: who's ahead and by how many. */
export type CountyLead = { fips: string; leader: Cand; votes: number };

/** Each county's lead in raw votes, for counties with votes on a map. */
export function countyLeads(counties: readonly CountyResult[]): CountyLead[] {
  return counties.flatMap((c) => {
    const [first, second] = [...c.candidates].sort((a, b) => b.votes - a.votes);
    if (!c.fips || !first || first.votes === 0 || first.votes === (second?.votes ?? 0)) return [];
    return [{ fips: c.fips, leader: first, votes: first.votes - (second?.votes ?? 0) }];
  });
}

/**
 * The two sides a swing is measured between: the Republican, and the Democrat or, with none on the ballot, the
 * strongest other candidate (Nebraska's independent). Null when the race has no Republican or nobody against one.
 */
export function swingSides(race: Pick<RaceDetail, "candidates">): { left: Cand; right: Cand } | null {
  const byVotes = [...race.candidates].sort((a, b) => b.votes - a.votes);
  const right = byVotes.find((c) => partyOf(c.party) === "R");
  const left = byVotes.find((c) => partyOf(c.party) === "D") ?? byVotes.find((c) => c !== right && partyOf(c.party) !== "R");
  return right && left ? { left, right } : null;
}

/** A county's shift from the 2024 presidential margin, in points: positive toward the left side (Harris's). */
export type CountySwing = { fips: string; now: number; then: number; shift: number; total: number };

/** Each counted county's margin now, its 2024 presidential margin, and the shift between them. */
export function countySwings(race: Pick<RaceDetail, "candidates" | "counties">): CountySwing[] {
  const sides = swingSides(race);
  if (!sides) return [];
  const votesOf = (c: CountyResult, name: string) => c.candidates.find((x) => x.name === name)?.votes ?? 0;
  return race.counties.flatMap((c) => {
    if (!c.fips || c.total <= 0 || c.baseline2024 === null) return [];
    const now = ((votesOf(c, sides.left.name) - votesOf(c, sides.right.name)) / c.total) * 100;
    return [{ fips: c.fips, now, then: c.baseline2024, shift: now - c.baseline2024, total: c.total }];
  });
}

/**
 * The counted counties together: their shift from 2024 weighted by votes counted, and how many have a different
 * leader from 2024's. Null with no county to compare.
 */
export function swingSummary(swings: readonly CountySwing[]): { shift: number; flipped: number; counties: number } | null {
  const total = swings.reduce((n, s) => n + s.total, 0);
  if (total === 0) return null;
  return {
    shift: swings.reduce((n, s) => n + s.shift * s.total, 0) / total,
    flipped: swings.filter((s) => s.now !== 0 && s.then !== 0 && Math.sign(s.now) !== Math.sign(s.then)).length,
    counties: swings.length,
  };
}
