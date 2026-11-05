// The race maps' Margin and Swing views, as DDHQ's county map has them: each county's raw vote lead, and how far it
// has moved from a past election (2024's presidential vote unless another is picked).
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

/** The past elections a swing can be measured from, newest first: 2024's presidential race, or one in `past`. */
export const SWING_BASES = ["2024-president", "2024-senate", "2022-senate", "2022-governor", "2020-president"] as const;
export type SwingBase = (typeof SWING_BASES)[number];
export const SWING_BASE_LABEL: Record<SwingBase, string> = {
  "2024-president": "2024 president",
  "2024-senate": "2024 Senate",
  "2022-senate": "2022 Senate",
  "2022-governor": "2022 governor",
  "2020-president": "2020 president",
};

/** A county's Democratic-minus-Republican margin in a past election, in points, or null when it had none on file. */
const marginIn = (c: CountyResult, base: SwingBase) => (base === "2024-president" ? c.baseline2024 : (c.past?.[base] ?? null));

/** The past elections the race's counties can be compared with, newest first. */
export function swingBases(race: Pick<RaceDetail, "counties">): SwingBase[] {
  return SWING_BASES.filter((base) => race.counties.some((c) => c.fips && marginIn(c, base) !== null));
}

/** A county's shift from a past margin, in points: positive toward the left side (the Democrat's). */
export type CountySwing = { fips: string; now: number; then: number; shift: number; total: number };

/** Each counted county's margin now, its margin in the `base` election, and the shift between them. */
export function countySwings(race: Pick<RaceDetail, "candidates" | "counties">, base: SwingBase = "2024-president"): CountySwing[] {
  const sides = swingSides(race);
  if (!sides) return [];
  const votesOf = (c: CountyResult, name: string) => c.candidates.find((x) => x.name === name)?.votes ?? 0;
  return race.counties.flatMap((c) => {
    const then = marginIn(c, base);
    if (!c.fips || c.total <= 0 || then === null) return [];
    const now = ((votesOf(c, sides.left.name) - votesOf(c, sides.right.name)) / c.total) * 100;
    return [{ fips: c.fips, now, then, shift: now - then, total: c.total }];
  });
}

/**
 * The counted counties together: their shift from the past election weighted by votes counted, and how many have a
 * different leader from then. Null with no county to compare.
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
