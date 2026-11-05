"use client";
// Rendered in map hover cards while a race is counting.

import type { RaceDetail } from "@/lib/midterms/races";
import { approx, VOTES_LEFT_CAVEAT as CAVEAT, votesLeft, type Share, type VotesLeft as Estimate } from "@/lib/midterms/votesLeft";
import { lastName } from "./CandidateTable";
import { useLive } from "./hooks";

const short = (s: Share) => lastName(s.name);

/** Whether the runner-up could catch up: the lead now against what they'd net from the votes left. */
function outlook(race: RaceDetail, est: Estimate): string {
  const counted = (s: Share) => race.candidates.find((c) => c.name === s.name)?.votes ?? 0;
  const gap = counted(est.leader) - counted(est.runnerUp);
  const net = est.runnerUp.votes - est.leader.votes;
  if (net > gap) return `enough for ${short(est.runnerUp)} to overtake a ${approx(gap)}-vote lead`;
  if (net > 0) return `${short(est.runnerUp)} would gain about ${approx(net)}, short of the ${approx(gap)}-vote gap`;
  return `${short(est.leader)}'s ${approx(gap)}-vote lead would grow`;
}

/** The estimate in a map hover card. Loads the race's counties when shown; the page's other polls keep it fresh. */
export function VotesLeftTip({ raceId }: { raceId: number }) {
  const race = useLive<{ race: RaceDetail }>(`/api/midterms/race/${raceId}`).data?.race;
  const est = race ? votesLeft(race) : null;
  if (!race) return <span className="mt-tip-left muted">Estimating votes left…</span>;
  if (!est || est.left === 0) return null;
  return (
    <span className="mt-tip-left" title={CAVEAT}>
      <b>~{approx(est.left)} votes left</b> · ~{approx(est.leader.votes)} {short(est.leader)}, ~{approx(est.runnerUp.votes)} {short(est.runnerUp)}
      <span className="muted"> · {outlook(race, est)}</span>
    </span>
  );
}
