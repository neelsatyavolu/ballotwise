// Rendered inside the tracker's client components.
import Link from "next/link";
import { colorOf, fmt, lead, partyTag, pct, raceLabel, RATING_LABEL, signalLine, type RaceSummary } from "@/lib/midterms/view";

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

/** One race at a glance: the top candidates, a stacked vote bar, and how much is counted. */
export function RaceCard({ race, starred, onStar }: { race: RaceSummary; starred: boolean | null; onStar: (id: number) => void }) {
  const top = race.candidates.slice(0, 3);
  const called = race.candidates.find((c) => c.winner);
  const ahead = lead(race.candidates);
  const label = raceLabel(race);
  return (
    <li className="mt-card">
      <div className="mt-card-top">
        <Link href={`/midterms/${race.id}`} className="mt-card-title">
          {label}
        </Link>
        <RatingTag rating={race.rating} signal={race.signal} />
        {starred !== null && <StarButton starred={starred} label={label} onToggle={() => onStar(race.id)} />}
      </div>
      <ul className="mt-card-cands">
        {top.map((c) => (
          <li key={c.name} className={c.winner ? "won" : undefined}>
            <span className="swatch" style={{ background: colorOf(c) }} aria-hidden />
            <span className="name">
              {c.name}
              {partyTag(c.party) && <span className="tag"> {partyTag(c.party)}</span>}
              {c.incumbent && <span className="tag" title="Incumbent">*</span>}
              {c.winner && <span className="mt-check" title="Called by civicAPI"> ✓</span>}
            </span>
            <span className="num">{race.total ? pct(c.pct) : "—"}</span>
          </li>
        ))}
      </ul>
      <div className="mt-stack" aria-hidden>
        {race.total > 0 && race.candidates.map((c) => <span key={c.name} style={{ width: `${c.pct}%`, background: colorOf(c) }} />)}
      </div>
      <div className="mt-card-foot">
        <span>{race.reporting > 0 ? `${Math.round(race.reporting)}% reporting` : (signalLine(race.signal) ?? "No results yet")}</span>
        {called ? <span className="called">Called</span> : ahead ? <span>Lead {ahead.margin.toFixed(1)} pts</span> : race.total > 0 ? <span>{fmt(race.total)} votes</span> : null}
      </div>
    </li>
  );
}
