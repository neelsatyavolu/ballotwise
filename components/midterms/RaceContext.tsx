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

/** What the count so far does and doesn't tell you: freshness, county coverage, and turnout and margin against 2024 in the counties that have reported. */
export function CountingContext({ race, fetchedAt }: { race: RaceDetail; fetchedAt: number }) {
  const regions = race.counties;
  const withVotes = regions.filter((c) => c.total > 0);
  const updated = race.updated ? Date.parse(race.updated) : NaN;
  const statewide = race.office !== "house";
  // 2024 comparisons only make sense for statewide races: a House district covers parts of counties.
  const base = statewide ? withVotes.filter((c) => c.pres2024) : [];
  const pres = sum(base.map((c) => c.pres2024!.total));
  const counted = sum(base.map((c) => c.total));
  const votesOf = (c: (typeof base)[number], p: "D" | "R") => sum(c.candidates.filter((x) => partyOf(x.party) === p).map((x) => x.votes));
  const nowMargin = counted ? ((sum(base.map((c) => votesOf(c, "D"))) - sum(base.map((c) => votesOf(c, "R")))) / counted) * 100 : null;
  const then = pres ? ((sum(base.map((c) => c.pres2024!.harris)) - sum(base.map((c) => c.pres2024!.trump))) / pres) * 100 : null;
  const partisan = race.office !== "measure" && race.candidates.some((c) => partyOf(c.party) === "D") && race.candidates.some((c) => partyOf(c.party) === "R");

  return (
    <section className="mt-context" aria-labelledby="context">
      <h2 id="context">Counting so far</h2>
      <ul>
        <li>
          {Number.isFinite(updated) ? `civicAPI last updated this race at ${stampET(updated)} ET` : "civicAPI gives no update time for this race"}; Ballotwise checked at {stampET(fetchedAt)} ET.
        </li>
        <li>
          {race.total === 0 ? "No votes counted yet." : race.reportingUnknown ? "civicAPI has votes but no reporting figure for this race." : `${Math.round(race.reporting)}% reporting, civicAPI's estimate of precincts or ballot batches in. It isn't the share of the expected vote.`}
        </li>
        {regions.length > 1 && (
          <li>
            {withVotes.length} of {regions.length} {regions.some((c) => c.fips) ? "counties" : "towns"} have reported votes
            {withVotes.length ? `; civicAPI reports 100% for ${regions.filter((c) => c.reporting >= 100).length} of them` : ""}.
          </li>
        )}
        {counted > 0 && pres > 0 && (
          <li>
            <details>
              <summary>Against 2024, in the {base.length} {base.length === 1 ? "county" : "counties"} with votes</summary>
              <p>
                {fmt(counted)} votes are recorded in this race there, {Math.round((counted / pres) * 100)}% of those counties&apos; final 2024 presidential vote.
                {partisan && nowMargin !== null && then !== null && <> The current partial margin there is {marginLabel(nowMargin)}; the final 2024 presidential margin was {marginLabel(then)}.</>}
              </p>
              <p className="muted">Historical context only. The votes counted so far may not be the same mix of precincts or ballot types as the final 2024 count, so this is neither a swing nor an estimate of the vote still out.</p>
            </details>
          </li>
        )}
        <li className="muted">civicAPI doesn&apos;t estimate how many votes remain, so this page doesn&apos;t either.</li>
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
