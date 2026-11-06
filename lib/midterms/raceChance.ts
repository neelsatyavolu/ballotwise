// A race's live chance on election night, county by county as DDHQ builds its own: the lead now plus what each
// county's votes left would net, split by that county's own margin (see votesLeft), with room for each county to
// split differently than estimated and for the estimate of how many votes are left to be off. Where DDHQ Pulse models
// the race, its chance is the one shown (the user's call, Nov 5); the projected margin stays ours. A ranked-choice race
// (Alaska's) is projected to its final round: each eliminated candidate's votes go to the finalist of their party.
import { phi } from "./forecast";
import { partyOf } from "./view";
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
/**
 * How far off the ranked-choice transfers could be, one standard deviation, as a share of the votes moved: not every
 * voter ranks a same-party candidate next (in Alaska's 2022 House special, Begich's went 50% to Palin, 29% to Peltola).
 */
const TRANSFER_SD = 0.3;

/** The projected winner, their chance, and the margin in votes they're projected to finish ahead by. */
export type RaceChance = { favorite: Share; other: Share; chance: number; margin: number; total: number; pulse: boolean; rcv: boolean };

/** The spread of the leader's final margin, in votes, from the counties' misses on how their votes left split. */
function splitSd(est: VotesLeft): number {
  const misses = est.breakdown.map((c) => c.left * (SPLIT_DONE + SPLIT_OPEN * (1 - Math.min(1, Math.max(0, c.counted)))));
  const shared = SHARED * misses.reduce((a, b) => a + b, 0);
  const own = (1 - SHARED ** 2) * misses.reduce((a, b) => a + b * b, 0);
  return Math.sqrt(shared ** 2 + own);
}

/**
 * A ranked-choice race's final round: every candidate's count plus their votes left (the two leaders' from `est`, the
 * rest of what's left shared by the others' counts), then each other candidate's total moved to the finalist of their
 * party. Votes for a candidate of neither finalist's party are left out, as exhausted. Null without ranked choice or
 * other candidates, or once the rounds have been run.
 */
function finalRound(race: Pick<RaceDetail, "candidates" | "rcv" | "round">, est: VotesLeft): { a: Share; b: Share; moved: number } | null {
  const others = race.candidates.filter((c) => c.name !== est.leader.name && c.name !== est.runnerUp.name && c.votes > 0);
  // Once the rounds have run (civicAPI's round above 1), the count is the final round already.
  if (!race.rcv || (race.round ?? 1) > 1 || !others.length) return null;
  const counted = (name: string) => race.candidates.find((c) => c.name === name)?.votes ?? 0;
  const othersCounted = others.reduce((n, c) => n + c.votes, 0);
  const othersLeft = Math.max(0, est.left - est.leader.votes - est.runnerUp.votes);
  const projected = [
    { name: est.leader.name, party: est.leader.party, votes: counted(est.leader.name) + est.leader.votes },
    { name: est.runnerUp.name, party: est.runnerUp.party, votes: counted(est.runnerUp.name) + est.runnerUp.votes },
    ...others.map((c) => ({ name: c.name, party: c.party, votes: c.votes + (othersLeft * c.votes) / othersCounted })),
  ].sort((x, y) => y.votes - x.votes);
  const [a, b, ...out] = projected;
  let moved = 0;
  const gain = [0, 0];
  for (const c of out) {
    const to = [a, b].findIndex((f) => partyOf(f.party) !== "other" && partyOf(f.party) === partyOf(c.party));
    if (to < 0) continue;
    gain[to] += c.votes;
    moved += c.votes;
  }
  // With nothing to move (a write-in, or no finalist of the others' party), the first round stands.
  return moved > 0 ? { a: { ...a, votes: a.votes + gain[0] }, b: { ...b, votes: b.votes + gain[1] }, moved } : null;
}

export function raceChance(race: Pick<RaceDetail, "candidates" | "total" | "rcv" | "round">, est: VotesLeft, pulse: { side: string; chance: number } | null = null): RaceChance {
  const counted = (s: Share) => race.candidates.find((c) => c.name === s.name)?.votes ?? 0;
  const net = est.leader.votes - est.runnerUp.votes;
  const total = race.total + est.left;
  const final = finalRound(race, est);
  // The two the race comes down to, the margin between them, and its spread: for ranked choice the final round's, with
  // room for the transfers to go otherwise.
  const [a, b] = final ? [final.a, final.b].map((f) => ({ ...f, votes: Math.round(f.votes) })) : [est.leader, est.runnerUp];
  const mean = final ? final.a.votes - final.b.votes : counted(est.leader) - counted(est.runnerUp) + net;
  const sd = Math.hypot(splitSd(est), net * SIZE_SD, (final?.moved ?? 0) * TRANSFER_SD, total * FLOOR_SD);
  const ours = sd > 0 ? phi(mean / sd) : mean >= 0 ? 1 : 0;
  // Pulse's chance for `a`: its favorite's chance, or the rest when its favorite is `b`.
  const side = pulse ? [sideOf(a.party), sideOf(b.party)].indexOf(pulse.side as never) : -1;
  const p = side < 0 || !pulse ? ours : side === 0 ? pulse.chance / 100 : 1 - pulse.chance / 100;
  const rcv = !!final;
  return p >= 0.5
    ? { favorite: a, other: b, chance: p, margin: Math.round(mean), total, pulse: side >= 0, rcv }
    : { favorite: b, other: a, chance: 1 - p, margin: Math.round(-mean), total, pulse: side >= 0, rcv };
}

/**
 * Whether the count looks done but may not be: nothing estimated left, yet the race is uncalled and DDHQ gives no
 * expected vote. civicAPI's 100% counts precincts, and mail, provisional and cured ballots can still come in (California
 * counts for weeks), so no chance is shown then.
 */
export function unfinishedCount(race: Pick<RaceDetail, "expected">, est: Pick<VotesLeft, "left">): boolean {
  return est.left === 0 && race.expected === undefined;
}
