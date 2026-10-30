// Rendered inside the tracker's client components.
import Link from "next/link";
import { lead, partyTag, raceLabel, type RaceSummary } from "@/lib/midterms/view";
import { partyColor } from "./party";
import { RatingTag } from "./RaceCard";
import { isCompetitive, isWatch } from "@/lib/midterms/explore";
import { reportingText } from "./reporting";
import { calledWinner } from "./SeatBoard";

export type Star = { ids: number[] | null; toggle: (id: number) => void };

/**
 * The key races as dense one-line rows: who leads, by how much, and how much is counted. `note` adds a grey line
 * under a race's name (Search uses it to say which candidate matched). `rated` false drops the rating column, for
 * local races, which have none.
 */
export function RaceRows({ races, star, onPick, selectedId, note, rated = true }: { races: RaceSummary[]; star: Star; onPick?: (race: RaceSummary) => void; selectedId?: number | null; note?: (race: RaceSummary) => string | null; rated?: boolean }) {
  return (
    <div className="mt-rows-wrap">
      <table className={`mt-table mt-rows${races.some((r) => r.total > 0) ? " counting" : ""}`}>
        <thead>
          <tr>
            <th>Race</th>
            {rated && <th>Rating</th>}
            <th>Leader</th>
            <th className="num">Lead</th>
            <th className="num" title="Precincts or ballot batches reported (civicAPI), not the share of the expected vote">Reporting</th>
            {star.ids && <th aria-label="Star" />}
          </tr>
        </thead>
        <tbody>
          {races.map((r) => {
            const ahead = lead(r.candidates);
            const winner = calledWinner(r);
            // A called race shows its winner, even one trailing in a partial count, never the count leader with a check.
            const shown = winner ?? (ahead ? ahead.leader : null);
            const runnerUp = shown ? r.candidates.find((c) => c !== shown) : undefined;
            const margin = shown && r.total ? shown.pct - (runnerUp?.pct ?? 0) : null;
            return (
              <tr key={r.id} className={[r.id === selectedId && "selected", isWatch(r) && "watch", isCompetitive(r) && "lean"].filter(Boolean).join(" ") || undefined} aria-current={r.id === selectedId ? "true" : undefined}>
                <td>
                  {onPick ? (
                    <button type="button" className="mt-linkish" onClick={() => onPick(r)}>{raceLabel(r)}</button>
                  ) : (
                    <Link href={`/midterms/${r.id}`}>{raceLabel(r)}</Link>
                  )}
                  {note?.(r) ? <span className="mt-row-about">{note(r)}</span> : r.about && <span className="mt-row-about" title={r.about.text}>{r.about.text}</span>}
                </td>
                {rated && <td><RatingTag rating={r.rating} signal={r.signal} /></td>}
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
          })}
        </tbody>
      </table>
    </div>
  );
}
