"use client";
// The race page's live projection while a race is counting: who's likely to win, from the lead and the votes left.

import { raceChance, unfinishedCount } from "@/lib/midterms/raceChance";
import type { RaceDetail } from "@/lib/midterms/races";
import { approx, VOTES_LEFT_CAVEAT, votesLeft } from "@/lib/midterms/votesLeft";
import { colorOf, fmt } from "@/lib/midterms/view";
import { lastName } from "./CandidateTable";
import { racePulse, usePulse } from "./usePulse";

/** A margin in votes as points of the vote: "0.4 pts", or "<0.1 pts" for a margin that rounds to nothing. */
const points = (votes: number, total: number) => {
  const pts = (votes / Math.max(1, total)) * 100;
  return pts < 0.05 ? "<0.1 pts" : `${pts.toFixed(1)} pts`;
};
const pct = (p: number) => (p > 0.99 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

export function LiveChance({ race }: { race: RaceDetail }) {
  const pulse = racePulse(usePulse(), race);
  const est = votesLeft(race);
  if (!est) return null;
  const c = raceChance(race, est, pulse);
  const name = (s: { name: string }) => lastName(s.name);
  if (!c.pulse && unfinishedCount(race, est)) return <Unfinished race={race} />;
  return (
    <section className="mt-mk" aria-label="Live projection">
      <h3 className="mt-mk-head">Live projection</h3>
      <div className="mt-mk-card mt-votes-left-card" title={c.pulse ? "Decision Desk HQ Pulse, DDHQ's live model" : `Ballotwise's estimate from each county's votes left and its margin. ${VOTES_LEFT_CAVEAT}`}>
        <p className="mt-mk-q">{c.pulse ? "DDHQ Pulse" : "Ballotwise, county by county"}{c.rcv ? " · after ranked-choice transfers" : ""}</p>
        <p className="mt-mk-lead">
          {name(c.favorite)} {pct(c.chance)}
        </p>
        <div className="mt-fc-split" role="img" aria-label={`${c.favorite.name} ${pct(c.chance)}, ${c.other.name} ${pct(1 - c.chance)}`}>
          <span style={{ width: `${c.chance * 100}%`, background: colorOf(c.favorite) }} />
          <span style={{ width: `${(1 - c.chance) * 100}%`, background: colorOf(c.other) }} />
        </div>
        <p className="small">
          {c.margin >= 0
            ? `Projected to win${c.rcv ? " the final round" : ""} by ~${fmt(c.margin)} votes (${points(c.margin, c.total)})`
            : `Our count projection has ${name(c.other)} ahead by ~${fmt(-c.margin)} votes`}
        </p>
        {c.rcv ? <p className="muted small">Each eliminated candidate&rsquo;s votes go to the finalist of their party.</p> : null}
        <p className="muted small">
          {est.left === 0 ? "Little or nothing left to count" : `~${approx(est.left)} votes left · ~${approx(est.leader.votes)} ${name(est.leader)}, ~${approx(est.runnerUp.votes)} ${name(est.runnerUp)}`}
          {est.places.length > 0 && ` · mostly ${est.places.map((p) => p.name).join(", ")}`}
        </p>
      </div>
    </section>
  );
}

/** An uncalled race whose count shows nothing left: its lead, and why no chance is given. */
function Unfinished({ race }: { race: RaceDetail }) {
  const [a, b] = [...race.candidates].sort((x, y) => y.votes - x.votes);
  if (!a || !b) return null;
  const lead = a.votes - b.votes;
  return (
    <section className="mt-mk" aria-label="Live projection">
      <h3 className="mt-mk-head">Live projection</h3>
      <div className="mt-mk-card mt-votes-left-card">
        <p className="mt-mk-q">Count not final</p>
        <p className="mt-mk-lead">
          {lastName(a.name)} +{fmt(lead)}
        </p>
        <p className="small">Leads by {fmt(lead)} votes ({points(lead, race.total)}), with the race not called.</p>
        <p className="muted small">
          Every precinct is in by civicAPI&rsquo;s count, but mail, provisional and cured ballots can still be counted, and this
          estimate can&rsquo;t see how many.
        </p>
      </div>
    </section>
  );
}
