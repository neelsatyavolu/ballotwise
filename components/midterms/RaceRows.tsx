// Rendered inside the tracker's client components.
import Link from "next/link";
import { colorOf, lead, partyTag, raceLabel, type RaceSummary } from "@/lib/midterms/view";
import { RatingTag } from "./RaceCard";

export type Star = { ids: number[] | null; toggle: (id: number) => void };

/** The key races as dense one-line rows: who leads, by how much, and how much is counted. */
export function RaceRows({ races, star, onPick, selectedId }: { races: RaceSummary[]; star: Star; onPick?: (race: RaceSummary) => void; selectedId?: number | null }) {
  return (
    <div className="mt-rows-wrap">
      <table className="mt-table mt-rows">
        <thead>
          <tr>
            <th>Race</th>
            <th>Rating</th>
            <th>Leader</th>
            <th className="num">Lead</th>
            <th className="num" title="Precincts or ballot batches reported (civicAPI), not the share of the expected vote">Reporting</th>
            {star.ids && <th aria-label="Star" />}
          </tr>
        </thead>
        <tbody>
          {races.map((r) => {
            const ahead = lead(r.candidates);
            const winner = r.candidates.find((c) => c.winner);
            return (
              <tr key={r.id} className={r.id === selectedId ? "selected" : undefined} aria-current={r.id === selectedId ? "true" : undefined}>
                <td>
                  {onPick ? (
                    <button type="button" className="mt-linkish" onClick={() => onPick(r)}>{raceLabel(r)}</button>
                  ) : (
                    <Link href={`/midterms/${r.id}`}>{raceLabel(r)}</Link>
                  )}
                  {r.about && <span className="mt-row-about" title={r.about.text}>{r.about.text}</span>}
                </td>
                <td><RatingTag rating={r.rating} signal={r.signal} /></td>
                <td className="mt-leader">
                  {ahead ? (
                    <>
                      <span className="swatch" style={{ background: colorOf(ahead.leader) }} aria-hidden /> {ahead.leader.name.split(" ").at(-1)}
                      {partyTag(ahead.leader.party) && <span className="muted"> {partyTag(ahead.leader.party)}</span>}
                      {winner && <span className="mt-check"> ✓</span>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="num">{ahead ? `+${ahead.margin.toFixed(1)}` : "—"}</td>
                <td className="num">{r.reporting ? `${Math.round(r.reporting)}%` : "0%"}</td>
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
