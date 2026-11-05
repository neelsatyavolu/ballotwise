// Rendered inside the tracker's client components.
import { EARLY_REPORTING, isEarly, statusOf } from "@/lib/midterms/explore";
import { holderOf, leadingFlip, outcomeOf } from "@/lib/midterms/holders";
import { stampTime, stateFinal, zoneAbbr } from "@/lib/midterms/polls";
import type { Observation } from "@/lib/midterms/history";
import type { RaceDetail } from "@/lib/midterms/races";
import { byTown, fmt, lead, partyTag } from "@/lib/midterms/view";
import { isDesk } from "@/lib/ddhq/apply";

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
  if (won) text = `${won.name} (${partyTag(won.party) || won.party || "no party"}) won${race.call && !race.call.withdrawn ? ` · call seen ${stampTime(race.call.at)} ${zoneAbbr(race.call.at)}` : ""}${o ? ` · ${o.side} ${o.gain ? "gain" : "hold"}` : ""}`;
  else if (race.call?.withdrawn) text = `The call for ${race.call.replaced} was withdrawn at ${stampTime(race.call.at)} ${zoneAbbr(race.call.at)}`;
  else if (statusOf(race) === "counting" && ahead && ahead.margin === 0) text = "Tied in the count so far";
  else if (statusOf(race) === "counting" && ahead) text = `${ahead.leader.name} leads by ${ahead.margin.toFixed(1)} points${second ? `, ${fmt(ahead.leader.votes - second.votes)} votes` : ""}${isEarly(race) ? `, an early count (under ${EARLY_REPORTING}% reporting)` : ""}${flip ? ` · would be a ${flip} flip` : ""}`;
  else text = final && final > now ? `No votes yet · polls close ${stampTime(final)} ${zoneAbbr(final)}` : "No votes counted yet";
  return (
    <p className={`mt-race-status${won ? " called" : race.call?.withdrawn ? " warn" : ""}`}>
      <b>{text}</b>
      {holder && race.office !== "measure" && <span className="muted">(seat held by {holder} going in)</span>}
      {race.call?.replaced && !race.call.withdrawn && won && <span className="mt-flag warn">Call changed from {race.call.replaced}</span>}
      {race.missing && <span className="mt-flag warn">civicAPI left this race out of its latest update; these are the last numbers we have{race.lastSeen ? `, as of ${stampTime(race.lastSeen)} ${zoneAbbr(race.lastSeen)}` : ""}</span>}
    </p>
  );
}

/**
 * Where the count stands, for the race header's meta line beside how much is in: when the source last updated, and
 * how many counties have votes and how many are done.
 */
export function CountingMeta({ race }: { race: RaceDetail }) {
  const regions = race.counties;
  const withVotes = regions.filter((c) => c.total > 0).length;
  const done = regions.filter((c) => c.done || c.reporting >= 100).length;
  const updated = race.updated ? Date.parse(race.updated) : NaN;
  const source = isDesk(race) ? "DDHQ" : race.source?.name ?? "civicAPI";
  return (
    <>
      {Number.isFinite(updated) && <span>{source} updated {stampTime(updated)} {zoneAbbr(updated)}</span>}
      {regions.length > 1 && (
        <span>
          {withVotes} of {regions.length} {byTown(regions) ? "towns" : "counties"} in, {done} done
        </span>
      )}
    </>
  );
}

/** The latest changes in the count, newest first: when, how many votes moved (negative is a correction), and the lead then. */
export function VoteUpdates({ history }: { history: readonly Observation[] }) {
  if (history.length < 2) return null;
  return (
    <section className="mt-context" aria-labelledby="updates">
      <div className="mt-section-head">
        <h2 id="updates">Vote updates</h2>
      </div>
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
                <td>{stampTime(h.at)}</td>
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
