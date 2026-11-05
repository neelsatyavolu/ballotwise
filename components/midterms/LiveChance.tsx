"use client";
// The race page's live projection while a race is counting: who's likely to win, from the lead and the votes left.

import { raceChance } from "@/lib/midterms/raceChance";
import type { RaceDetail } from "@/lib/midterms/races";
import { approx, VOTES_LEFT_CAVEAT, votesLeft } from "@/lib/midterms/votesLeft";
import { colorOf, fmt } from "@/lib/midterms/view";
import { lastName } from "./CandidateTable";

/** A margin in votes as points of the vote: "0.4 pts", or "<0.1 pts" for a margin that rounds to nothing. */
const points = (votes: number, total: number) => {
  const pts = (votes / Math.max(1, total)) * 100;
  return pts < 0.05 ? "<0.1 pts" : `${pts.toFixed(1)} pts`;
};
const pct = (p: number) => (p > 0.99 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

export function LiveChance({ race }: { race: RaceDetail }) {
  const est = votesLeft(race);
  if (!est) return null;
  const c = raceChance(race, est);
  const name = (s: { name: string }) => lastName(s.name);
  return (
    <section className="mt-mk" aria-label="Live projection">
      <h3 className="mt-mk-head">Live projection</h3>
      <div className="mt-mk-card mt-votes-left-card" title={`Ballotwise's estimate from the count and the votes left. ${VOTES_LEFT_CAVEAT}`}>
        <p className="mt-mk-lead">
          {name(c.favorite)} {pct(c.chance)}
        </p>
        <div className="mt-fc-split" role="img" aria-label={`${c.favorite.name} ${pct(c.chance)}, ${c.other.name} ${pct(1 - c.chance)}`}>
          <span style={{ width: `${c.chance * 100}%`, background: colorOf(c.favorite) }} />
          <span style={{ width: `${(1 - c.chance) * 100}%`, background: colorOf(c.other) }} />
        </div>
        <p className="small">
          Projected to win by ~{fmt(c.margin)} votes ({points(c.margin, c.total)})
        </p>
        <p className="muted small">
          {est.left === 0 ? "Little or nothing left to count" : `~${approx(est.left)} votes left · ~${approx(est.leader.votes)} ${name(est.leader)}, ~${approx(est.runnerUp.votes)} ${name(est.runnerUp)}`}
          {est.places.length > 0 && ` · mostly ${est.places.map((p) => p.name).join(", ")}`}
        </p>
      </div>
    </section>
  );
}
