// A race's live chance on election night, county by county as DDHQ builds its own: the lead now plus what each
// county's votes left would net, split by that county's own margin (see votesLeft), with room for each county to
// split differently than estimated and for the estimate of how many votes are left to be off. Where DDHQ Pulse models
// the race, its chance is the one shown (the user's call, Nov 5); the projected margin stays ours.
import { phi } from "./forecast";
import type { RaceDetail } from "./races";
import { sideOf } from "./seats";
import type { Share, VotesLeft } from "./votesLeft";

/**
 * How far a county's votes left could split from its estimate, one standard deviation, in points of their own margin:
 * SPLIT_DONE for a county nearly done, whose count says how its last ballots go, up to SPLIT_DONE + SPLIT_OPEN for one
 * barely started, whose remaining vote may be another kind (election day after mail) that leans another way.
 */
const SPLIT_DONE = 0.05;
const SPLIT_OPEN = 0.15;
/** How much of the counties' misses run together (a statewide misread) rather than cancelling out, 0 to 1. */
const SHARED = 0.6;
/** How far off the estimate of how many votes are left could be, one standard deviation, as a share of what they'd net. */
const SIZE_SD = 0.35;
/** The least the final margin could still move, as a share of all votes: corrections, provisional and cured ballots. */
const FLOOR_SD = 0.0003;

/** The projected winner, their chance, and the margin in votes they're projected to finish ahead by. */
export type RaceChance = { favorite: Share; other: Share; chance: number; margin: number; total: number; pulse: boolean };

/** The spread of the leader's final margin, in votes, from the counties' misses on how their votes left split. */
function splitSd(est: VotesLeft): number {
  const misses = est.breakdown.map((c) => c.left * (SPLIT_DONE + SPLIT_OPEN * (1 - Math.min(1, Math.max(0, c.counted)))));
  const shared = SHARED * misses.reduce((a, b) => a + b, 0);
  const own = (1 - SHARED ** 2) * misses.reduce((a, b) => a + b * b, 0);
  return Math.sqrt(shared ** 2 + own);
}

export function raceChance(race: Pick<RaceDetail, "candidates" | "total">, est: VotesLeft, pulse: { side: string; chance: number } | null = null): RaceChance {
  const counted = (s: Share) => race.candidates.find((c) => c.name === s.name)?.votes ?? 0;
  const net = est.leader.votes - est.runnerUp.votes;
  const mean = counted(est.leader) - counted(est.runnerUp) + net;
  const total = race.total + est.left;
  const sd = Math.hypot(splitSd(est), net * SIZE_SD, total * FLOOR_SD);
  const ours = sd > 0 ? phi(mean / sd) : mean >= 0 ? 1 : 0;
  // Pulse's chance for the leader of the count: its favorite's chance, or the rest when its favorite is the runner-up.
  const side = pulse ? [sideOf(est.leader.party), sideOf(est.runnerUp.party)].indexOf(pulse.side as never) : -1;
  const p = side < 0 || !pulse ? ours : side === 0 ? pulse.chance / 100 : 1 - pulse.chance / 100;
  return p >= 0.5
    ? { favorite: est.leader, other: est.runnerUp, chance: p, margin: Math.round(mean), total, pulse: side >= 0 }
    : { favorite: est.runnerUp, other: est.leader, chance: 1 - p, margin: Math.round(-mean), total, pulse: side >= 0 };
}
