// The companion screen's live projection: each chamber's final seats and chance of control on election night. It runs
// the forecast's own chamber simulation (chamberViews, with its shared national, regional and lean-bucket errors) on
// chances updated by the night so far. A called race is settled. A counting race blends its forecast with its count,
// trusting the count more as more of it is reported. A race with no votes keeps its forecast, moved by how far the
// well-counted races have run ahead of or behind theirs. Before any votes it is the published forecast. Where DDHQ
// Pulse (Decision Desk HQ's live model) is in hand, each race it models and each chamber's control is combined with it.
import { chamberViews, phi, phiInverse, type Body, type ChamberView, type Side } from "./forecast";
import { chamberEntries, raceKey, sideOf } from "./seats";
import type { RaceSummary } from "./races";

type Odds = Partial<Record<Side, number>>;

/** A race's forecast uncertainty in points, when its forecast doesn't give one. */
const DEFAULT_SIGMA = 8;
/**
 * How far the votes still out could move a count's lead, in points, scaled by the share still out. The first few
 * percent are often one kind of vote (mail, or Election Day), so a count tells little until more is in (COUNT_EARLY).
 */
const COUNT_SD = 15;
/** How slowly a count earns trust at the start: the spread is divided by the share reported to this power. */
const COUNT_EARLY = 0.25;
/** The least a count's lead may still move before the race is called, in points. */
const COUNT_FLOOR = 0.5;
/** Share of the vote taken as counted when civicAPI gives votes but no reporting figure. */
const UNKNOWN_REPORTING = 0.3;
/** A race informs the national read once this share of it is reported. */
const SWING_FROM = 0.5;
/** Races' worth of evidence the national read is shrunk toward the forecast by, so a few early counts barely move it. */
const SWING_PRIOR = 10;
/** One race's miss counts for at most this many of its own σ in the national read. */
const SWING_CAP = 2;
/** As many simulations as the published forecast, so before any votes the two agree. */
const RUNS = 10_000;
/** How many of each chamber's undecided races the projection lists. */
const CLOSE_RACES = 12;
/**
 * DDHQ Pulse's share of a combined chance. Pulse reads DDHQ's own precinct returns and expected vote, which we don't
 * have; ours carries the published forecast and the night's swing. Neither has a record tonight to favor it, so they
 * count equally.
 */
const PULSE_WEIGHT = 0.5;

const clampP = (p: number) => Math.min(0.999, Math.max(0.001, p));
const sigmaOf = (race: RaceSummary) => race.signal?.forecast?.sigma ?? DEFAULT_SIGMA;
const forecastOdds = (race: RaceSummary): Odds | null => race.signal?.forecast?.odds ?? null;

/** Share of the race counted, from 0 to just under 1. */
function reported(race: RaceSummary): number {
  return race.reportingUnknown ? UNKNOWN_REPORTING : Math.min(0.995, Math.max(0, race.reporting / 100));
}

/** `a`'s chance against `b` alone, from the forecast's odds (even when it has neither). */
function pairChance(odds: Odds | null, a: Side, b: Side): number {
  const pa = odds?.[a] ?? 0;
  const pb = odds?.[b] ?? 0;
  return pa + pb > 0 ? pa / (pa + pb) : 0.5;
}

/** The two sides ahead in the count and the leader's chance of holding on; null before votes or without two parties. */
export function countChance(race: RaceSummary): { lead: Side; trail: Side; p: number } | null {
  if (race.total === 0) return null;
  const [first, second] = [...race.candidates].sort((x, y) => y.votes - x.votes);
  const lead = first ? sideOf(first.party) : null;
  const trail = second ? sideOf(second.party) : null;
  if (!lead || !trail) return null;
  if (lead === trail) return { lead, trail, p: 1 };
  const sigma = sigmaOf(race);
  const prior = sigma * phiInverse(clampP(pairChance(forecastOdds(race), lead, trail)));
  const margin = ((first.votes - second.votes) / race.total) * 100;
  const r = reported(race);
  const countSd = (COUNT_SD * (1 - r)) / Math.max(r, 0.01) ** COUNT_EARLY + COUNT_FLOOR;
  const wPrior = 1 / sigma ** 2;
  const wCount = 1 / countSd ** 2;
  const mean = (prior * wPrior + margin * wCount) / (wPrior + wCount);
  return { lead, trail, p: phi(mean / Math.sqrt(1 / (wPrior + wCount))) };
}

/**
 * How far Democrats are running ahead of the forecast (negative: behind), in races' own σ, from Democrat-vs-Republican
 * races at least SWING_FROM reported, weighted by how much is in and shrunk toward zero.
 */
export function nationalSwing(races: readonly RaceSummary[]): number {
  let sum = 0;
  let weight = 0;
  for (const race of races) {
    const r = reported(race);
    if (race.office === "measure" || race.total === 0 || race.reportingUnknown || r < SWING_FROM) continue;
    const d = race.candidates.find((c) => sideOf(c.party) === "D");
    const rep = race.candidates.find((c) => sideOf(c.party) === "R");
    if (!d || !rep) continue;
    const sigma = sigmaOf(race);
    const expected = sigma * phiInverse(clampP(pairChance(forecastOdds(race), "D", "R")));
    const actual = ((d.votes - rep.votes) / race.total) * 100;
    sum += r * Math.min(SWING_CAP, Math.max(-SWING_CAP, (actual - expected) / sigma));
    weight += r;
  }
  return sum / (weight + SWING_PRIOR);
}

/**
 * Our chance and DDHQ Pulse's for the same outcome, combined on the probit scale by PULSE_WEIGHT; ours alone without
 * Pulse's, and a settled one (0 or 1) left settled.
 */
export function blendChance(ours: number, pulse: number | null): number {
  if (pulse === null || ours <= 0 || ours >= 1) return ours;
  return phi((1 - PULSE_WEIGHT) * phiInverse(clampP(ours)) + PULSE_WEIGHT * phiInverse(clampP(pulse)));
}

/** What the projection takes from DDHQ Pulse: each chamber's Democratic chance and each modeled race's favorite, in percent. */
export type PulseInput = {
  chambers: Partial<Record<"senate" | "house", { dem: number }>>;
  races: Readonly<Record<string, { side: Side; chance: number }>>;
};

/** `odds` with the Democrat-versus-Republican chance combined with Pulse's for the race, when Pulse models it. */
function withPulse(race: RaceSummary, odds: Odds | null, pulse: PulseInput | undefined): Odds | null {
  const p = pulse?.races[raceKey(race.office, race.state, race.district)];
  if (!p || p.side === "I" || !odds || odds.D === undefined || odds.R === undefined || race.candidates.some((c) => c.winner)) return odds;
  const both = odds.D + odds.R;
  const d = blendChance(pairChance(odds, "D", "R"), p.side === "D" ? p.chance / 100 : 1 - p.chance / 100);
  return { ...odds, D: d * both, R: (1 - d) * both };
}

/** A race's chances given the night so far (see the top of this file); null when it has no forecast and no count. */
export function liveOdds(race: RaceSummary, swing: number): Odds | null {
  const winner = race.candidates.find((c) => c.winner);
  if (winner) {
    const side = sideOf(winner.party);
    // A winner from another party holds no seat for either side.
    return side ? { [side]: 1 } : {};
  }
  const count = countChance(race);
  if (count) return count.lead === count.trail ? { [count.lead]: 1 } : { [count.lead]: count.p, [count.trail]: 1 - count.p };
  const odds = forecastOdds(race);
  if (!odds || swing === 0 || odds.D === undefined || odds.R === undefined) return odds;
  const both = odds.D + odds.R;
  const d = phi(phiInverse(clampP(pairChance(odds, "D", "R"))) + swing);
  return { ...odds, D: d * both, R: (1 - d) * both };
}

/** An undecided race in a chamber's list: who leads (or is favored before votes) and that side's chance. */
export type RaceOutlook = {
  id: number;
  office: Body;
  state: string;
  district: number | null;
  title: string;
  /** The side favored to win and its chance. */
  side: Side;
  chance: number;
  /** The count's leader and lead in points, or null before votes. */
  leader: string | null;
  margin: number | null;
  reporting: number;
  reportingUnknown: boolean;
};

export type ChamberProjection = Pick<ChamberView, "dControl" | "dSeats" | "rSeats" | "majority" | "notUp"> & {
  /** `dControl` is the combined chance when DDHQ Pulse has one: `ours` before combining, and `pulse` its own (0 to 1). */
  ours: number;
  pulse: number | null;
  /** Seats won tonight (an independent with the Democrats, as in the seat totals). */
  won: { D: number; R: number };
  counting: number;
  waiting: number;
  /** The undecided races nearest a coin flip. */
  close: RaceOutlook[];
};

export type LiveProjection = { swing: number; chambers: Record<Body, ChamberProjection> };

function outlook(race: RaceSummary & { office: Body }, odds: Odds): RaceOutlook | null {
  const ranked = (Object.entries(odds) as [Side, number][]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [first, second] = [...race.candidates].sort((x, y) => y.votes - x.votes);
  const counting = race.total > 0 && first;
  return {
    id: race.id,
    office: race.office,
    state: race.state,
    district: race.district,
    title: race.title,
    side: ranked[0][0],
    chance: ranked[0][1] / ranked.reduce((s, [, p]) => s + p, 0),
    leader: counting ? first.name : null,
    margin: counting ? ((first.votes - (second?.votes ?? 0)) / race.total) * 100 : null,
    reporting: race.reporting,
    reportingUnknown: !!race.reportingUnknown,
  };
}

const BODIES: Body[] = ["senate", "house", "governor"];
const isBody = (r: RaceSummary): r is RaceSummary & { office: Body } => (BODIES as string[]).includes(r.office);

/** Each chamber's live projection from the overview's races, combined with DDHQ Pulse where `pulse` has it. */
export function projectChambers(races: readonly RaceSummary[], runs = RUNS, pulse?: PulseInput): LiveProjection {
  const swing = nationalSwing(races);
  const live = new Map(races.map((r) => [r, withPulse(r, liveOdds(r, swing), pulse)]));
  const views = chamberViews(chamberEntries(races, (r) => {
    const odds = live.get(r);
    return odds ? { odds } : null;
  }), runs);
  const chamber = (office: Body): ChamberProjection => {
    const mine = races.filter(isBody).filter((r) => r.office === office);
    const won = { D: 0, R: 0 };
    const close: RaceOutlook[] = [];
    let counting = 0;
    let waiting = 0;
    for (const race of mine) {
      const winner = race.candidates.find((c) => c.winner);
      if (winner) {
        const side = sideOf(winner.party);
        if (side === "R") won.R += 1;
        else if (side) won.D += 1;
        continue;
      }
      if (race.total > 0) counting += 1;
      else waiting += 1;
      const odds = live.get(race);
      const row = odds && outlook(race, odds);
      if (row) close.push(row);
    }
    const { dControl, dSeats, rSeats, majority, notUp } = views[office];
    const theirs = office === "governor" ? undefined : pulse?.chambers[office];
    const pulseD = theirs ? theirs.dem / 100 : null;
    return { dControl: blendChance(dControl, pulseD), ours: dControl, pulse: pulseD, dSeats, rSeats, majority, notUp, won, counting, waiting, close: close.sort((a, b) => a.chance - b.chance).slice(0, CLOSE_RACES) };
  };
  return { swing, chambers: { senate: chamber("senate"), house: chamber("house"), governor: chamber("governor") } };
}
