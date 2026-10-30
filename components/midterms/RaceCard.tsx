// Rendered inside the tracker's client components.
import Link from "next/link";
import { stampET, stateFinal } from "@/lib/midterms/polls";
import { lead, raceLabel, RATING_LABEL, signalLine, type RaceSummary } from "@/lib/midterms/view";
import { CandidateTable } from "./CandidateTable";
import { useClock } from "./hooks";
import { partyColor } from "./party";

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

/** Where a card's count stands, for the footer of its candidates table: called, the lead, or when polls close. */
function CardStatus({ race }: { race: RaceSummary }) {
  const now = useClock(60_000);
  const ahead = lead(race.candidates);
  if (race.candidates.some((c) => c.winner)) return <span className="called">Called</span>;
  if (ahead) return <span>Lead {ahead.margin.toFixed(1)} pts</span>;
  const final = stateFinal(race.state);
  return <span>{final && final > now ? `Polls close ${stampET(final)} ET` : "No results yet"}</span>;
}

/** One race at a glance: the top candidates as a results table, a stacked vote bar once votes are in, and how much is counted. */
export function RaceCard({ race, starred, onStar }: { race: RaceSummary; starred: boolean | null; onStar: (id: number) => void }) {
  const label = raceLabel(race);
  const sub = race.total ? null : signalLine(race.signal);
  return (
    <li className="mt-card">
      <div className="mt-card-top">
        <Link href={`/midterms/${race.id}`} className="mt-card-title">
          {label}
        </Link>
        <RatingTag rating={race.rating} signal={race.signal} />
        {starred !== null && <StarButton starred={starred} label={label} onToggle={() => onStar(race.id)} />}
      </div>
      {race.about && <p className="mt-card-about" title={race.about.text}>{race.about.text}</p>}
      {sub && <p className="mt-card-sub">{sub}</p>}
      {race.total > 0 && (
        <div className="mt-stack" aria-hidden>
          {race.candidates.map((c) => <span key={c.name} style={{ width: `${c.pct}%`, background: partyColor(c) }} />)}
        </div>
      )}
      <CandidateTable race={race} limit={3} short fill status={<CardStatus race={race} />} />
    </li>
  );
}
