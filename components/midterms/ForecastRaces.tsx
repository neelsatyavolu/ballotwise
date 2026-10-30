// Rendered inside the Forecast tab: the most competitive races, closest to a coin flip first, as DDHQ lists them.
import Link from "next/link";
import { useMemo, useState } from "react";
import { safeSide } from "@/lib/midterms/explore";
import type { ForecastOffice } from "@/lib/midterms/forecastTab";
import { chances, favoriteChance, ratingFill, RATING_LABEL, safeFill, STATE_NAMES, type RaceSummary } from "@/lib/midterms/view";

/** "Ohio 7", "Wyoming At-Large", "Iowa", "Ohio (special)". */
export function forecastName(r: RaceSummary): string {
  const state = STATE_NAMES[r.state] ?? r.state;
  if (r.office === "house") return `${state} ${r.district ? r.district : "At-Large"}`;
  return /special/i.test(r.title) ? `${state} (special)` : state;
}

/** The forecast's map color for a race, whatever the count says: the rating, or Safe, or grey with no forecast. */
export function forecastFill(r: RaceSummary): string {
  if (r.rating) return ratingFill(r.rating);
  const safe = safeSide(r);
  return safe ? safeFill(safe) : ratingFill(null);
}

/** A race's rating as text: "Toss-up", "Lean D", "Safe R", or a dash with no forecast. */
function ratingText(r: RaceSummary): string {
  if (r.rating) return RATING_LABEL[r.rating];
  const safe = safeSide(r);
  return safe ? `Safe ${safe}` : "—";
}

const FILTERS = [
  { id: "all", label: "All ratings" },
  { id: "Toss-up", label: "Toss-up" },
  { id: "Lean D", label: "Lean D" },
  { id: "Lean R", label: "Lean R" },
  { id: "Likely D", label: "Likely D" },
  { id: "Likely R", label: "Likely R" },
  { id: "Safe D", label: "Safe D" },
  { id: "Safe R", label: "Safe R" },
] as const;

/**
 * Where a race's dot sits on the Democratic ← | → Republican axis (0 to 100, 50 is a coin flip), and the favorite's
 * chance. Independents favored over a Republican sit on the left with the Democrats.
 */
export function dotOf(r: RaceSummary): { x: number; p: number } | null {
  const odds = chances(r.signal);
  if (!odds) return null;
  const rep = odds.R ?? 0;
  const left = Math.max(odds.D ?? 0, odds.I ?? 0);
  const p = Math.max(rep, left);
  return { x: rep >= left ? 50 + (p - 0.5) * 100 : 50 - (p - 0.5) * 100, p };
}

/** The office's races, most competitive first, with a search box, a rating filter and a dot plot of each favorite's chance. */
export function ForecastRaces({ office, races, limit }: { office: ForecastOffice; races: readonly RaceSummary[]; limit: number }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return races
      .filter((r) => r.office === office)
      .filter((r) => filter === "all" || ratingText(r) === filter)
      .filter((r) => !q || `${forecastName(r)} ${r.state} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => favoriteChance(a) - favoriteChance(b) || forecastName(a).localeCompare(forecastName(b), undefined, { numeric: true }));
  }, [races, office, filter, query]);
  const shown = all ? list : list.slice(0, limit);
  const unit = office === "house" ? "district" : "state";

  return (
    <div className="mt-fc-races">
      <div className="mt-fc-filters">
        <input className="input" type="search" placeholder={`Search ${unit}…`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${unit}`} />
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter by rating">
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>
      <table className="mt-fc-table">
        <thead>
          <tr>
            <th>{office === "house" ? "District" : "State"}</th>
            <th className="axis">
              <span>← Democratic</span>
              <span>Republican →</span>
            </th>
            <th className="rating">Rating</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const dot = dotOf(r);
            const fill = forecastFill(r);
            return (
              <tr key={r.id}>
                <td>
                  <Link href={`/midterms/${r.id}`}>{forecastName(r)} ›</Link>
                </td>
                <td className="axis">
                  <span className="mt-fc-track" aria-hidden>
                    <i className="mid" />
                    {dot && (
                      <span className={`mt-fc-dot${dot.x > 50 ? " right" : ""}`} style={{ left: `${dot.x}%` }}>
                        <b style={{ background: fill }} />
                        <em style={{ color: fill }}>{Math.round(dot.p * 100)}%</em>
                      </span>
                    )}
                  </span>
                </td>
                <td className="rating" style={{ color: r.rating === "tossup" ? "var(--ink)" : fill }}>{ratingText(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!list.length && <p className="muted small">No races match.</p>}
      {list.length > limit && (
        <button type="button" className="btn secondary small mt-fc-more" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}
