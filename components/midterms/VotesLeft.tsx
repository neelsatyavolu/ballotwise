"use client";
// Rendered on race pages and in map hover cards while a race is counting.

import type { RaceDetail } from "@/lib/midterms/races";
import { votesLeft, type Share, type VotesLeft as Estimate } from "@/lib/midterms/votesLeft";
import { fmt } from "@/lib/midterms/view";
import { lastName } from "./CandidateTable";
import { useLive } from "./hooks";

/** A rough count, so it doesn't read as exact: 182,431 is "182,000", 4,620 is "4,600". */
function approx(n: number): string {
  const step = n >= 10_000 ? 1_000 : n >= 1_000 ? 100 : 10;
  return fmt(Math.round(n / step) * step);
}

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

/** "Fulton (Dee +40)": who a place favors among the two leaders, by how much. */
function placeLabel(est: Estimate, p: Estimate["places"][number]): string {
  if (p.edge === null || Math.round(p.edge) === 0) return p.name;
  return `${p.name} (${short(p.edge > 0 ? est.leader : est.runnerUp)} +${Math.abs(Math.round(p.edge))})`;
}

const CAVEAT = "A rough estimate: civicAPI's reporting figure counts precincts or ballot batches, not ballots, and late mail can lean differently from the count so far.";

/** The estimate as a race-page panel: how many votes are left, how they'd split, where they are and what it means. */
export function VotesLeftPanel({ race }: { race: RaceDetail }) {
  const est = votesLeft(race);
  if (!est) return null;
  return (
    <div className="mt-turnout mt-votes-left">
      {est.left === 0 ? (
        <p>
          <b>Little or nothing left to count</b> by civicAPI&apos;s reporting figures.
        </p>
      ) : (
        <>
          <p>
            <b>About {approx(est.left)} votes left</b>, roughly {approx(est.leader.votes)} for {short(est.leader)} and {approx(est.runnerUp.votes)} for {short(est.runnerUp)}: {outlook(race, est)}.
          </p>
          {est.places.length > 0 && <p>Most are in {est.places.map((p) => placeLabel(est, p)).join(", ")}.</p>}
        </>
      )}
      <p className="muted small">
        {CAVEAT}
        {est.unknown > 0 && ` ${est.unknown} ${est.unknown === 1 ? "county has" : "counties have"} nothing counted and no 2024 vote to go on, so ${est.unknown === 1 ? "it isn't" : "they aren't"} included.`}
      </p>
    </div>
  );
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
