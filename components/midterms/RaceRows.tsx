// Rendered inside the tracker's client components.
import Link from "next/link";
import { useRef } from "react";
import { lead, partyTag, raceLabel, type RaceSummary } from "@/lib/midterms/view";
import { approx, approxShort, VOTES_LEFT_CAVEAT } from "@/lib/midterms/votesLeft";
import { partyColor } from "./party";
import { RatingTag } from "./RaceCard";
import { isCompetitive, isTossup } from "@/lib/midterms/explore";
import { reportingText } from "./reporting";
import { calledWinner } from "./SeatBoard";
import { pickIn, type RacePick } from "@/lib/midterms/picks";
import { lastName } from "./CandidateTable";
import { PickTag, usePicks } from "./picks";
import { racePulse, usePulse } from "./usePulse";
import { useOnScreen, useVotesLeft } from "./useVotesLeft";
import type { Pulse } from "@/lib/ddhq/pulse";

export type Star = { ids: number[] | null; toggle: (id: number) => void };

/** DDHQ Pulse's live favorite and chance, colored by party; a dash where DDHQ doesn't model the race live. */
function PulseCell({ pulse, race }: { pulse: Pulse | null; race: RaceSummary }) {
  const p = racePulse(pulse, race);
  if (!p) return <td className="num muted">—</td>;
  const chance = Math.round(p.chance);
  return (
    <td className="num mt-pulse" title={`DDHQ Pulse, Decision Desk HQ's live model: ${p.name} ${chance}% to win`}>
      <b className={`p-${p.side}`}>{p.side} {chance}%</b>
    </td>
  );
}

type RowProps = { r: RaceSummary; star: Star; onPick?: (race: RaceSummary) => void; selected: boolean; note?: (race: RaceSummary) => string | null; found: RacePick | null; pulse: Pulse | null; showPulse: boolean; showLeft: boolean; bare: boolean };

function RaceRow({ r, star, onPick, selected, note, found, pulse, showPulse, showLeft, bare }: RowProps) {
  const row = useRef<HTMLTableRowElement>(null);
  // The estimate needs the race's counties, so a row loads them only while it's on screen and the race is counting.
  const left = useVotesLeft(r, useOnScreen(row) && showLeft);
  const ahead = lead(r.candidates);
  const winner = calledWinner(r);
  // A called race shows its winner, even one trailing in a partial count, never the count leader with a check.
  const shown = winner ?? (ahead ? ahead.leader : null);
  const runnerUp = shown ? r.candidates.find((c) => c !== shown) : undefined;
  const margin = shown && r.total ? shown.pct - (runnerUp?.pct ?? 0) : null;
  const label = raceLabel(r);
  const name = bare ? label.replace(/ (?:Senate|Governor)\b/, "") : label;
  const full = name === label ? undefined : label;
  return (
    <tr ref={row} className={[selected && "selected", isTossup(r) && "watch", isCompetitive(r) && "lean"].filter(Boolean).join(" ") || undefined} aria-current={selected ? "true" : undefined}>
      <td>
        {onPick ? (
          <button type="button" className="mt-linkish" title={full ?? label} onClick={() => onPick(r)}>{name}</button>
        ) : (
          <Link href={`/midterms/${r.id}`} title={full ?? label}>{name}</Link>
        )}
        {note?.(r) ? <span className="mt-row-about">{note(r)}</span> : r.about && <span className="mt-row-about" title={r.about.text}>{r.about.text}</span>}
        {found && (
          <span className="mt-row-pick">
            <PickTag found={found} name={found.names[0]} label={`Your match: ${found.names.map(lastName).join(", ")}`} />
          </span>
        )}
      </td>
      <td><RatingTag rating={r.rating} signal={r.signal} /></td>
      <td className="mt-leader">
        {shown && (winner || ahead) ? (
          <>
            <span className="swatch" style={{ background: partyColor(shown) }} aria-hidden /> {shown.name.split(" ").at(-1)}
            {partyTag(shown.party) && <span className="muted"> {partyTag(shown.party)}</span>}
            {winner && <span className="mt-check" title="Called"> ✓</span>}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="num">{margin === null ? "—" : `${margin >= 0 ? "+" : "−"}${Math.abs(margin).toFixed(1)}`}</td>
      {showPulse && <PulseCell pulse={pulse} race={r} />}
      {showLeft && (
        <td className="num mt-row-left" title={left ? `About ${approx(left.left)} votes left${left.favors ? `; ${left.favors.name} would net about ${approx(left.net)} of them` : ", splitting about evenly"}. ${VOTES_LEFT_CAVEAT}` : undefined}>
          {!left ? <span className="muted">—</span> : left.favors ? <b style={{ color: partyColor(left.favors) }}>+{approxShort(left.net)}</b> : <span className="muted">Even</span>}
        </td>
      )}
      <td className="num" title={reportingText(r).title}>{reportingText(r).short}</td>
      {star.ids && (
        <td>
          <button type="button" className={`mt-star sm${star.ids.includes(r.id) ? " on" : ""}`} aria-pressed={star.ids.includes(r.id)} aria-label={`Star ${raceLabel(r)}`} onClick={() => star.toggle(r.id)}>
            {star.ids.includes(r.id) ? "★" : "☆"}
          </button>
        </td>
      )}
    </tr>
  );
}

/**
 * The key races as dense one-line rows: who leads, by how much, DDHQ Pulse's live chance where it models the race, the
 * net votes the estimated votes left would add (colored for who gains them), and how much is counted. `note` adds a
 * grey line under a race's name (Search uses it to say which candidate matched). A list of one Senate or governor
 * office names each race by its state.
 */
export function RaceRows({ races, star, onPick, selectedId, note }: { races: RaceSummary[]; star: Star; onPick?: (race: RaceSummary) => void; selectedId?: number | null; note?: (race: RaceSummary) => string | null }) {
  const picks = usePicks();
  const pulse = usePulse();
  const counting = races.some((r) => r.total > 0);
  // Pulse only covers Senate and governor races, so a list of House races has no column for it.
  const showPulse = races.some((r) => racePulse(pulse, r));
  // Every row the same Senate or governor office (an office page): the state alone names the race.
  const bare = races.length > 0 && races.every((r) => r.office === races[0].office && (r.office === "senate" || r.office === "governor"));
  return (
    <div className="mt-rows-wrap">
      <table className={`mt-table mt-rows${counting ? " counting" : ""}`}>
        <thead>
          <tr>
            <th>Race</th>
            <th>Rating</th>
            <th>Leader</th>
            <th className="num">Lead</th>
            {showPulse && <th className="num" title="DDHQ Pulse, Decision Desk HQ's live model: the favorite's chance to win">Pulse</th>}
            {counting && <th className="num" title={`Net votes the estimated votes still to count would add, colored for who gains them. ${VOTES_LEFT_CAVEAT}`}>Left</th>}
            <th className="num" title="Reporting: precincts or ballot batches reported (civicAPI), not the share of the expected vote">In</th>
            {star.ids && <th aria-label="Star" />}
          </tr>
        </thead>
        <tbody>
          {races.map((r) => (
            <RaceRow key={r.id} r={r} star={star} onPick={onPick} selected={r.id === selectedId} note={note} found={pickIn(r, picks)} pulse={pulse} showPulse={showPulse} showLeft={counting} bare={bare} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
