// A race's live chance on election night, from the count and the votes-left estimate: the lead now plus what the
// votes left would net (see votesLeft), with room for the estimate to be wrong about how they split and how many
// there are.
import { phi } from "./forecast";
import type { RaceDetail } from "./races";
import type { Share, VotesLeft } from "./votesLeft";

/** How far the votes left could split from the estimate, one standard deviation, in points of their own margin. */
const SPLIT_SD = 0.08;
/** How far off the estimate of how many votes are left could be, one standard deviation, as a share of it. */
const SIZE_SD = 0.35;
/** The least the final margin could still move, as a share of all votes: corrections, provisional and cured ballots. */
const FLOOR_SD = 0.0003;

/** The projected winner, their chance, and the margin in votes they're projected to finish ahead by. */
export type RaceChance = { favorite: Share; other: Share; chance: number; margin: number; total: number };

export function raceChance(race: Pick<RaceDetail, "candidates" | "total">, est: VotesLeft): RaceChance {
  const counted = (s: Share) => race.candidates.find((c) => c.name === s.name)?.votes ?? 0;
  const net = est.leader.votes - est.runnerUp.votes;
  const mean = counted(est.leader) - counted(est.runnerUp) + net;
  const total = race.total + est.left;
  const sd = Math.hypot(est.left * SPLIT_SD, net * SIZE_SD, total * FLOOR_SD);
  const p = sd > 0 ? phi(mean / sd) : mean >= 0 ? 1 : 0;
  return mean >= 0
    ? { favorite: est.leader, other: est.runnerUp, chance: p, margin: Math.round(mean), total }
    : { favorite: est.runnerUp, other: est.leader, chance: 1 - p, margin: Math.round(-mean), total };
}
