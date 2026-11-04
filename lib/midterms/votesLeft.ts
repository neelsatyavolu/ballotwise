// A rough estimate of the vote still to count in a race, county by county, and how it might split.
import type { CountyResult, RaceDetail } from "./races";
import { fmt, partyOf } from "./view";

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

/** A rough count, so it doesn't read as exact: 182,431 is "182,000", 4,620 is "4,600". */
export function approx(n: number): string {
  const step = n >= 10_000 ? 1_000 : n >= 1_000 ? 100 : 10;
  return fmt(Math.round(n / step) * step);
}

/** The same, short for a narrow column: "57K", "1.2M", "4.6K", "820". */
export function approxShort(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 9_950) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return approx(n);
}

export const VOTES_LEFT_CAVEAT = "A rough estimate: civicAPI's reporting figure counts precincts or ballot batches, not ballots, and late mail can lean differently from the count so far.";

const PLACES = 3;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * This midterm's vote as a share of 2024's presidential vote, where the estimate starts before moving toward what the
 * counted counties show. 2022 cast about 0.68 of 2020's presidential vote and 2018 about 0.83 of 2016's. 2026 runs
 * high: 57 million early ballots by Nov 2, a quarter more than 2022's whole early vote, and Kalshi's House turnout
 * market centered near 117 million votes, which puts the nation near 0.77.
 */
export const MIDTERM_TURNOUT = 0.77;
/**
 * The same for a state with a competitive race: in 2022 those ran about 0.07 above the nation (Georgia, Pennsylvania,
 * Wisconsin and Arizona cast 0.76 to 0.81 of their 2020 vote, against 0.68 nationally).
 */
export const CONTESTED_TURNOUT = 0.83;
/** Where a race's turnout starts: higher for one rated likely, lean or toss-up. */
export const turnoutPrior = (race: Pick<RaceDetail, "rating">) => (race.rating ? CONTESTED_TURNOUT : MIDTERM_TURNOUT);
/** How much the starting turnout weighs, as a share of the state's 2024 vote: counted counties outweigh it past this. */
const PRIOR_WEIGHT = 0.05;
/**
 * How far a county's scaled-up count is trusted: its reporting share to this power. Cubed, a county half counted
 * weighs an eighth and one 90% counted about three quarters. Tuned on mock nights, with every county counted evenly
 * and with half of them counting mail before precincts (there, average error fell from far off to about 6%).
 */
const TRUST = 3;
const trust = (c: CountyResult) => Math.min(1, c.reporting / 100) ** TRUST;

/** A county's count scaled up by its reporting figure, or null when the figure can't be used. */
function scaledOf(c: CountyResult): number | null {
  return c.total > 0 && c.reporting > 0 && !c.reportingUnknown ? (c.total * 100) / Math.min(100, c.reporting) : null;
}

/**
 * This year's vote against 2024's: `prior` (see turnoutPrior), moved toward what the counted counties show as more of
 * the state counts. Each county's scaled-up count weighs by how far it's counted (see TRUST): a county that counts its
 * mail first can show a big count a few precincts in, and scaling that up would put its turnout many times too high.
 */
function turnoutOf(counties: readonly CountyResult[], prior: number): number {
  const k = sum(counties.map((c) => c.pres2024?.total ?? 0)) * PRIOR_WEIGHT;
  const used = counties.flatMap((c) => {
    const scaled = scaledOf(c);
    return c.pres2024?.total && scaled !== null ? [{ w: trust(c), scaled, pres: c.pres2024.total }] : [];
  });
  const counted = sum(used.map((u) => u.w * u.scaled));
  const pres = sum(used.map((u) => u.w * u.pres));
  return k + pres > 0 ? (counted + k * prior) / (pres + k) : prior;
}

/**
 * Roughly how many votes a county has left: DDHQ's expected vote less what's counted, when it's there. Else two guesses: its count scaled up by its reporting figure, and its 2024
 * presidential vote at this year's turnout less what's counted. The reporting figure counts precincts, and many
 * counties count early and mail ballots before any precinct, so a county a few precincts in can already have most of
 * its vote; scaled up, that's many times too much. The 2024 guess leads until the count is well along, and the scaled
 * count takes over as it nears done (see TRUST). A House district covers parts of counties, so whole-county 2024 votes
 * can't stand in and only the scaled count is used. Null when neither is known.
 */
function leftIn(c: CountyResult, turnout: number, statewide: boolean): number | null {
  if (c.reporting >= 100 || c.done) return 0;
  // DDHQ's own expected vote, where a connected account has it: built from live turnout reports, it beats both guesses.
  if (c.expected !== undefined) return Math.max(0, c.expected - c.total);
  const scaled = scaledOf(c);
  const prior = statewide && c.pres2024?.total ? Math.max(0, c.pres2024.total * turnout - c.total) : null;
  if (scaled === null) return prior;
  if (prior === null) return scaled - c.total;
  const w = trust(c);
  return w * (scaled - c.total) + (1 - w) * prior;
}

/**
 * How far the counted counties have moved toward the Democrat since 2024, as a share of the vote (each county's
 * Democratic lead now minus Harris's lead there then), or 0 when none can be compared. A county weighs by its count
 * times the share of its expected vote that's in (`counted`), so one that has counted only its early mail, which
 * leans its own way, moves the swing little until the rest of its vote comes in.
 */
function swingOf(counties: readonly { c: CountyResult; counted: number }[]): number {
  const votesOf = (c: CountyResult, side: "D" | "R") => sum(c.candidates.filter((x) => partyOf(x.party) === side).map((x) => x.votes));
  const base = counties.flatMap(({ c, counted }) => {
    const p = c.pres2024;
    if (!(c.total > 0) || !p?.total) return [];
    const swing = (votesOf(c, "D") - votesOf(c, "R")) / c.total - (p.harris - p.trump) / p.total;
    return [{ w: c.total * counted, swing }];
  });
  const weight = sum(base.map((b) => b.w));
  return weight > 0 ? sum(base.map((b) => b.w * b.swing)) / weight : 0;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The two leaders' shares of a county's 2024 presidential vote, moved by `swing` (see swingOf); null without a D-R pair. */
function leanIn(c: CountyResult, parties: readonly [string, string], swing: number): [number, number] | null {
  const p = c.pres2024;
  const side = parties.map(partyOf);
  if (!p?.total || !side.includes("D") || !side.includes("R")) return null;
  const of = (s: string) => clamp01(s === "D" ? p.harris / p.total + swing / 2 : s === "R" ? p.trump / p.total - swing / 2 : 0);
  return [of(side[0]), of(side[1])];
}

/**
 * A candidate's votes in a county: by name, else by party where one candidate there has it. A connected DDHQ account
 * names the race's candidates its own way ("Cynthia Wirth") while civicAPI's counties keep theirs ("Cinde Wirth").
 */
function votesIn(c: CountyResult, name: string, party: string): number {
  const named = c.candidates.find((x) => x.name === name);
  if (named) return named.votes;
  const side = partyOf(party);
  const same = side === "other" ? [] : c.candidates.filter((x) => partyOf(x.party) === side);
  return same.length === 1 ? same[0].votes : 0;
}

/**
 * The two leaders' shares of a county's remaining vote. Where some is counted: its shares so far, blended toward its
 * 2024 lean moved by the swing (see leanIn) by how much of its vote is still out (`counted` is the share in). A county
 * that counts its mail or early vote first shows that vote's lean, and what's left there (mostly election-day vote)
 * usually leans the other way, so the count so far only takes over as the county nears done. A House district's
 * counties are only partly in it, so there the count's shares stand alone. With nothing counted, the 2024 lean, else
 * the leaders' shares statewide.
 */
function sharesIn(c: CountyResult, counted: number, names: readonly [string, string], parties: readonly [string, string], statewide: readonly [number, number], swing: number, whole: boolean): [number, number] {
  if (c.total === 0) return leanIn(c, parties, swing) ?? [...statewide];
  const [a, b] = names.map((n, i) => votesIn(c, n, parties[i]) / c.total);
  const lean = whole ? leanIn(c, parties, swing) : null;
  return lean ? [counted * a + (1 - counted) * lean[0], counted * b + (1 - counted) * lean[1]] : [a, b];
}

type Row = { name: string; left: number; a: number; b: number; edge: number | null };

/**
 * The county estimates scaled to `left`, DDHQ's own figure for the race (its expected vote less the count), keeping
 * where they put the vote and how it splits. With no county estimate to scale, one row split by the race's shares.
 */
function toExpected(rows: readonly Row[], left: number, title: string, overall: readonly [number, number]): Row[] {
  const sumLeft = sum(rows.map((r) => r.left));
  if (sumLeft > 0) return rows.map((r) => ({ ...r, left: (r.left * left) / sumLeft, a: (r.a * left) / sumLeft, b: (r.b * left) / sumLeft }));
  return left > 0 ? [{ name: title, left, a: left * overall[0], b: left * overall[1], edge: (overall[0] - overall[1]) * 100 }] : [];
}

/**
 * Roughly how many votes are left in a race still counting and how they might split between the two leaders, from each
 * county's count, reporting figure and 2024 vote (see leftIn), split by the count so far and the 2024 lean moved by the
 * swing since (see sharesIn). Where a connected DDHQ account gives the race's expected vote, what's left totals that
 * less the count (see toExpected), so it agrees with DDHQ's "% in".
 * civicAPI's reporting figure counts precincts or ballot batches, not ballots, and late mail can lean differently, so
 * it's an estimate to read loosely. Null before any votes, once called, or with fewer than two candidates.
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
  const turnout = turnoutOf(counties, turnoutPrior(race));
  // How much of each county's vote is in, by the estimate: its count against its count plus what's left.
  const estimated = counties.map((c) => {
    const left = leftIn(c, turnout, statewide);
    return { c, left, counted: left === null ? 0 : c.total + left > 0 ? c.total / (c.total + left) : 1 };
  });
  const swing = swingOf(estimated);
  const byCounty = estimated.flatMap(({ c, left, counted }) => {
    if (!left) return [];
    const [sa, sb] = sharesIn(c, counted, names, parties, overall, swing, statewide);
    return [{ name: c.name, left, a: left * sa, b: left * sb, edge: sa + sb > 0 ? (sa - sb) * 100 : null }];
  });
  const rows = race.expected === undefined ? byCounty : toExpected(byCounty, Math.max(0, race.expected - race.total), race.title, overall);
  return {
    left: Math.round(sum(rows.map((r) => r.left))),
    leader: { name: a.name, party: a.party, votes: Math.round(sum(rows.map((r) => r.a))) },
    runnerUp: { name: b.name, party: b.party, votes: Math.round(sum(rows.map((r) => r.b))) },
    places: rows
      .sort((x, y) => y.left - x.left)
      .slice(0, PLACES)
      .map((r) => ({ name: r.name, left: Math.round(r.left), edge: r.edge })),
    unknown: estimated.filter((e) => e.left === null).length,
  };
}
