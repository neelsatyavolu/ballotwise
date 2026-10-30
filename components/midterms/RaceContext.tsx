// Rendered inside the tracker's client components.
import { EARLY_REPORTING, isEarly, statusOf } from "@/lib/midterms/explore";
import { holderOf, leadingFlip, outcomeOf } from "@/lib/midterms/holders";
import { stampET, stateFinal } from "@/lib/midterms/polls";
import type { Observation } from "@/lib/midterms/history";
import type { RaceDetail } from "@/lib/midterms/races";
import { fmt, lead, marginLabel, partyOf, partyTag } from "@/lib/midterms/view";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Where the race stands in one line: called (and when we saw it), withdrawn, counting, or waiting on polls. */
export function RaceStatus({ race, now }: { race: RaceDetail; now: number }) {
  const won = race.candidates.find((c) => c.winner);
  const ahead = lead(race.candidates);
  const second = race.candidates[1];
  const o = outcomeOf(race);
  const flip = leadingFlip(race);
  const holder = holderOf(race);
  const final = stateFinal(race.state);
  let text: string;
  if (won) text = `${won.name} (${partyTag(won.party) || won.party || "no party"}) won${race.call && !race.call.withdrawn ? ` · call seen ${stampET(race.call.at)} ET` : ""}${o ? ` · ${o.side} ${o.gain ? "gain" : "hold"}` : ""}`;
  else if (race.call?.withdrawn) text = `The call for ${race.call.replaced} was withdrawn at ${stampET(race.call.at)} ET`;
  else if (statusOf(race) === "counting" && ahead && ahead.margin === 0) text = "Tied in the count so far";
  else if (statusOf(race) === "counting" && ahead) text = `${ahead.leader.name} leads by ${ahead.margin.toFixed(1)} points${second ? `, ${fmt(ahead.leader.votes - second.votes)} votes` : ""}${isEarly(race) ? `, an early count (under ${EARLY_REPORTING}% reporting)` : ""}${flip ? ` · would be a ${flip} flip` : ""}`;
  else text = final && final > now ? `No votes yet · polls close ${stampET(final)} ET` : "No votes counted yet";
  return (
    <p className={`mt-race-status${won ? " called" : race.call?.withdrawn ? " warn" : ""}`}>
      <b>{text}</b>
      {holder && race.office !== "measure" && <span className="muted"> · seat held by {holder} going in</span>}
      {race.call?.replaced && !race.call.withdrawn && won && <span className="mt-flag warn">Call changed from {race.call.replaced}</span>}
      {race.missing && <span className="mt-flag warn">civicAPI left this race out of its latest update; these are the last numbers we have{race.lastSeen ? `, as of ${stampET(race.lastSeen)} ET` : ""}</span>}
    </p>
  );
}

/** Votes counted so far in the reporting counties against their final 2024 presidential vote, statewide races only. */
function against2024(race: RaceDetail) {
  // A House district covers parts of counties, so whole-county 2024 totals don't compare.
  const base = race.office !== "house" ? race.counties.filter((c) => c.total > 0 && c.pres2024) : [];
  const pres = sum(base.map((c) => c.pres2024!.total));
  const counted = sum(base.map((c) => c.total));
  const votesOf = (c: (typeof base)[number], p: "D" | "R") => sum(c.candidates.filter((x) => partyOf(x.party) === p).map((x) => x.votes));
  const nowMargin = counted ? ((sum(base.map((c) => votesOf(c, "D"))) - sum(base.map((c) => votesOf(c, "R")))) / counted) * 100 : null;
  const then = pres ? ((sum(base.map((c) => c.pres2024!.harris)) - sum(base.map((c) => c.pres2024!.trump))) / pres) * 100 : null;
  const partisan = race.office !== "measure" && race.candidates.some((c) => partyOf(c.party) === "D") && race.candidates.some((c) => partyOf(c.party) === "R");
  return { counties: base.length, pres, counted, nowMargin: partisan ? nowMargin : null, then: partisan ? then : null };
}

/**
 * The headline under the candidates: how the count so far compares with 2024's final vote in the counties that have
 * reported. Context, never a projection of what's left.
 */
export function TurnoutLine({ race }: { race: RaceDetail }) {
  const t = against2024(race);
  if (!t.counted || !t.pres) return null;
  return (
    <div className="mt-turnout">
      <p>
        <b>{Math.round((t.counted / t.pres) * 100)}% of 2024&apos;s vote</b> is counted in the {t.counties} {t.counties === 1 ? "county" : "counties"} reporting ({fmt(t.counted)} of {fmt(t.pres)}).
        {t.nowMargin !== null && t.then !== null && <> The partial margin there is {marginLabel(t.nowMargin)}; 2024&apos;s final presidential margin was {marginLabel(t.then)}.</>}
      </p>
      <p className="muted small">Not a projection. The votes in so far may not be the same mix of precincts or ballot types as 2024&apos;s final count, so this is neither a swing nor an estimate of the vote still out.</p>
    </div>
  );
}

/** What the count so far does and doesn't tell you: freshness and county coverage. */
export function CountingContext({ race, fetchedAt }: { race: RaceDetail; fetchedAt: number }) {
  const regions = race.counties;
  const withVotes = regions.filter((c) => c.total > 0);
  const updated = race.updated ? Date.parse(race.updated) : NaN;
  const source = race.source?.name ?? "civicAPI";

  return (
    <section className="mt-context" aria-labelledby="context">
      <h2 id="context">Counting so far</h2>
      <ul>
        <li>
          {Number.isFinite(updated) ? `${source} last updated ${race.source ? "its results" : "this race"} at ${stampET(updated)} ET` : `${source} gives no update time for this race`}; Ballotwise checked at {stampET(fetchedAt)} ET.
        </li>
        <li>
          {race.total === 0 ? "No votes counted yet." : race.reportingUnknown || !race.reporting ? `${source} has votes but gives no reporting figure for this race.` : `${Math.round(race.reporting)}% reporting, ${race.source ? `${source}'s count of precincts` : "civicAPI's estimate of precincts or ballot batches"} in. It isn't the share of the expected vote${race.reporting >= 99 && !race.candidates.some((c) => c.winner) ? "; mail, provisional and late ballots can still come in" : ""}.`}
        </li>
        {regions.length > 1 && (
          <li>
            {withVotes.length} of {regions.length} {regions.some((c) => c.fips) ? "counties" : "towns"} have reported votes
            {withVotes.length ? `; civicAPI reports 100% for ${regions.filter((c) => c.reporting >= 100).length} of them` : ""}.
          </li>
        )}
        <li className="muted">{source} doesn&apos;t estimate how many votes remain here, so this page doesn&apos;t either.</li>
      </ul>
    </section>
  );
}

/** The latest changes in the count, newest first: when, how many votes moved (negative is a correction), and the lead then. */
export function VoteUpdates({ history }: { history: readonly Observation[] }) {
  if (history.length < 2) return null;
  return (
    <section className="mt-context" aria-labelledby="updates">
      <h2 id="updates">Vote updates</h2>
      <table className="mt-table mt-updates">
        <thead>
          <tr>
            <th>Seen</th>
            <th className="num">Votes</th>
            <th className="num">Change</th>
            <th>Lead</th>
            <th className="num">Reporting</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            const prev = history[i + 1];
            const delta = prev ? h.total - prev.total : null;
            return (
              <tr key={h.at}>
                <td>{stampET(h.at)}</td>
                <td className="num">{fmt(h.total)}</td>
                <td className="num">{delta === null ? "—" : `${delta >= 0 ? "+" : "−"}${fmt(Math.abs(delta))}`}{h.corrected && <span className="mt-flag warn"> correction</span>}</td>
                <td>{h.leadName ? `${h.leadName}${h.leadParty && partyTag(h.leadParty) ? ` (${partyTag(h.leadParty)})` : ""} +${(h.margin ?? 0).toFixed(1)}` : "—"}</td>
                <td className="num">{h.reporting === null ? "Unknown" : `${Math.round(h.reporting)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Recorded when any candidate&apos;s count changes: right away for a correction or a new leader, otherwise at most every five minutes. Times are when Ballotwise saw the count.</p>
    </section>
  );
}
