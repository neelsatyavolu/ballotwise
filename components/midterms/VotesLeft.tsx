"use client";
// Rendered on race pages and in map hover cards while a race is counting.

import type { RaceDetail } from "@/lib/midterms/races";
import { approx, VOTES_LEFT_CAVEAT as CAVEAT, votesLeft, type Share, type VotesLeft as Estimate } from "@/lib/midterms/votesLeft";
import { colorOf } from "@/lib/midterms/view";
import { lastName } from "./CandidateTable";
import { useLive } from "./hooks";

const short = (s: Share) => lastName(s.name);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

/** The estimate as a race-page panel: how many votes are left, how they'd split, where they are and what it means. */
export function VotesLeftPanel({ race }: { race: RaceDetail }) {
  const est = votesLeft(race);
  if (!est) return null;
  return (
    <div className="mt-turnout mt-votes-left">
      {est.left === 0 ? (
        <p>
          <b>Little or nothing left to count</b>
        </p>
      ) : (
        <>
          <p>
            <b>~{approx(est.left)} votes left</b> · ~{approx(est.leader.votes)} {short(est.leader)}, ~{approx(est.runnerUp.votes)} {short(est.runnerUp)}. {cap(outlook(race, est))}.
          </p>
          {est.places.length > 0 && <p className="muted small">Mostly in {est.places.map((p) => placeLabel(est, p)).join(", ")}</p>}
        </>
      )}
      <p className="muted small" title={CAVEAT}>
        Rough estimate{est.unknown > 0 ? `, excluding ${est.unknown} ${est.unknown === 1 ? "county" : "counties"} with no data` : ""}
      </p>
    </div>
  );
}

/**
 * The estimate as a card for a state's panel once its race is counting, where it takes the place of polls and
 * markets: votes left, how the top two would split them, what that means, and where they are. The caveat is kept to
 * the hover title to save room. `brief` drops the heading, for a wall screen read from across the room.
 */
export function VotesLeftCard({ race, brief = false }: { race: RaceDetail; brief?: boolean }) {
  const est = votesLeft(race);
  if (!est) return null;
  const top = [est.leader, est.runnerUp];
  const both = est.leader.votes + est.runnerUp.votes;
  const says = outlook(race, est);
  return (
    <section className="mt-mk" aria-label="Votes left">
      {!brief && <h3 className="mt-mk-head">Votes left</h3>}
      <div className="mt-mk-card mt-votes-left-card" title={CAVEAT}>
        <p className="mt-mk-q">Estimated votes still to count</p>
        {est.left === 0 ? (
          <p className="mt-mk-lead">Little or nothing left</p>
        ) : (
          <>
            <p className="mt-mk-lead">About {approx(est.left)}</p>
            {both > 0 && (
              <div className="mt-fc-split" role="img" aria-label={top.map((s) => `about ${approx(s.votes)} for ${s.name}`).join(", ")}>
                {top.map((s) => (
                  <span key={s.name} style={{ width: `${(s.votes / both) * 100}%`, background: colorOf(s) }} />
                ))}
              </div>
            )}
            <ul className="mt-mk-legend">
              {top.map((s) => (
                <li key={s.name}>
                  <svg width="10" height="10" aria-hidden>
                    <rect width="10" height="10" rx="2" style={{ fill: colorOf(s) }} />
                  </svg>
                  {short(s)} <span>~{approx(s.votes)}</span>
                </li>
              ))}
            </ul>
            <p className="small">{cap(says)}.</p>
            {est.places.length > 0 && <p className="muted small">Most are in {est.places.map((p) => placeLabel(est, p)).join(", ")}.</p>}
          </>
        )}
        {!brief && est.unknown > 0 && (
          <p className="muted small">
            Excludes {est.unknown} {est.unknown === 1 ? "county" : "counties"} with no data
          </p>
        )}
      </div>
    </section>
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
