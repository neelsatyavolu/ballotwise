// Rendered inside the tracker's client components.
import Link from "next/link";
import { useRef } from "react";
import { stampTime, stateFinal, zoneAbbr } from "@/lib/midterms/polls";
import { lead, raceLabel, RATING_LABEL, signalLine, type RaceSummary } from "@/lib/midterms/view";
import { CandidateTable } from "./CandidateTable";
import { useClock } from "./hooks";
import { useOnScreen, useVotesLeft } from "./useVotesLeft";
import { partyColor } from "./party";
import { racePulse, usePulse } from "./usePulse";

export function StarButton({ starred, onToggle, label }: { starred: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className={`mt-star${starred ? " on" : ""}`} aria-pressed={starred} aria-label={`${starred ? "Unstar" : "Star"} ${label}`} title={starred ? "Starred" : "Star this race"} onClick={onToggle}>
      {starred ? "★" : "☆"}
    </button>
  );
}

export function RatingTag({ rating, signal }: { rating: RaceSummary["rating"]; signal?: RaceSummary["signal"] }) {
  if (!rating) return null;
  return (
    <span className={`mt-rating r-${rating}`} title={signalLine(signal) ?? undefined}>
      {RATING_LABEL[rating]}
    </span>
  );
}

/** DDHQ Pulse's live favorite in the race, small beside its rating; nothing once it's called or where DDHQ has none. */
export function PulseTag({ race }: { race: RaceSummary }) {
  const pulse = racePulse(usePulse(), race);
  if (!pulse) return null;
  const chance = Math.round(pulse.chance);
  return (
    <span className="mt-pulse" title={`DDHQ Pulse, Decision Desk HQ's live model: ${pulse.name} ${chance}% to win`}>
      Pulse <b className={`p-${pulse.side}`}>{pulse.side} {chance}%</b>
    </span>
  );
}

/** Where a card's count stands, for the footer of its candidates table: called, the lead, or when polls close. */
/** `zone` adds the time zone to a call's time ("PT"); a card's header leaves it out for room. */
export function CardStatus({ race, zone = true }: { race: RaceSummary; zone?: boolean }) {
  const now = useClock(60_000);
  const ahead = lead(race.candidates);
  // When the call was made, as DDHQ's "#DecisionMade" line shows it: a race can be called before any votes are in.
  if (race.candidates.some((c) => c.winner)) return <span className="called">Called{race.call && !race.call.withdrawn ? ` ${stampTime(race.call.at)}${zone ? ` ${zoneAbbr(race.call.at)}` : ""}` : ""}</span>;
  // A connected screen showing civicAPI's count until DDHQ posts its first votes says so.
  if (ahead) return <span title={race.countFrom === "civic" ? "civicAPI's count, which is ahead of Decision Desk HQ's" : undefined}>Lead {ahead.margin.toFixed(1)} pts</span>;
  const final = stateFinal(race.state);
  return <span>{final && final > now ? `Polls close ${stampTime(final)} ${zoneAbbr(final)}` : "No results yet"}</span>;
}

/**
 * One race at a glance: the top candidates as a results table, a stacked vote bar once votes are in, how much is
 * counted, and the estimated votes still to count.
 */
/** `bare` cuts a Senate or governor title to the state, for screens where every card is the same office (the walls); no state has two of either this year. */
export function RaceCard({ race, starred, onStar, limit = 3, bare = false }: { race: RaceSummary; starred: boolean | null; onStar: (id: number) => void; limit?: number; bare?: boolean }) {
  const label = raceLabel(race);
  const title = bare ? label.replace(/ (?:Senate|Governor)\b.*$/, "") : label;
  // Before votes or a call, the forecast alone; the markets and polls behind it are in the line's hover title.
  const sub = race.total || race.candidates.some((c) => c.winner) ? null : signalLine(race.signal, race, true);
  const card = useRef<HTMLLIElement>(null);
  const left = useVotesLeft(race, useOnScreen(card));
  // A called race's call time goes up by its name in place of its rating, and the status row (the call and the vote
  // total) is left out.
  const called = race.candidates.some((c) => c.winner);
  return (
    <li className="mt-card" data-race={race.id} ref={card}>
      <div className="mt-card-top">
        <Link href={`/midterms/${race.id}`} className="mt-card-title" title={title === label ? undefined : label}>
          {title}
        </Link>
        {called && <span className="mt-card-called"><CardStatus race={race} zone={false} /></span>}
        <PulseTag race={race} />
        {/* Once called, the pre-election rating gives way to the call's time. */}
        {!called && <RatingTag rating={race.rating} signal={race.signal} />}
        {starred !== null && <StarButton starred={starred} label={label} onToggle={() => onStar(race.id)} />}
      </div>
      {race.about && <p className="mt-card-about" title={race.about.text}>{race.about.text}</p>}
      {sub && <p className="mt-card-sub" title={signalLine(race.signal, race) ?? undefined}>{sub}</p>}
      {race.total > 0 && (
        <div className="mt-stack" aria-hidden>
          {race.candidates.map((c) => <span key={c.name} style={{ width: `${c.pct}%`, background: partyColor(c) }} />)}
        </div>
      )}
      <CandidateTable race={race} limit={limit} short fill status={called ? null : <CardStatus race={race} />} left={left} />
    </li>
  );
}
