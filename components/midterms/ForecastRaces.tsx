// Rendered inside the Forecast tab: the most competitive races, closest to a coin flip first.
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

/** The favorite and its chance, for the table's percentage column. */
function favoriteOf(odds: Partial<Record<"D" | "R" | "I", number>>): { party: "D" | "R" | "I"; p: number } {
  const [party, p] = (Object.entries(odds) as ["D" | "R" | "I", number][]).reduce((a, b) => (b[1] > a[1] ? b : a));
  return { party, p };
}

const INK = { D: "var(--dem-ink)", R: "var(--rep-ink)", I: "var(--oth)" } as const;

/** The race's rating as a chip, in the same style as the race lists: dotted for Safe, a dash with no forecast. */
function RatingChip({ race }: { race: RaceSummary }) {
  if (race.rating) return <span className={`mt-rating r-${race.rating}`}>{RATING_LABEL[race.rating]}</span>;
  const safe = safeSide(race);
  return safe ? <span className="mt-rating r-safe">Safe {safe}</span> : <span className="mt-rating r-none">—</span>;
}

/** Each side's chance as one split bar, Democrats from the left and Republicans from the right, a tick at even. */
function ChanceBar({ odds }: { odds: Partial<Record<"D" | "R" | "I", number>> }) {
  return (
    <span className="mt-fc-chance" aria-hidden>
      <span style={{ width: `${(odds.D ?? 0) * 100}%`, background: "var(--dem)" }} />
      <span style={{ width: `${(odds.I ?? 0) * 100}%`, background: "var(--oth)" }} />
      <span style={{ flex: 1 }} />
      <span style={{ width: `${(odds.R ?? 0) * 100}%`, background: "var(--rep)" }} />
      <i />
    </span>
  );
}

/** The office's races, most competitive first, with a search box, a rating filter and each side's chance as a split bar. */
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
      <div className="mt-rows-wrap">
        <table className="mt-table mt-rows mt-fc-table">
          <thead>
            <tr>
              <th>{office === "house" ? "District" : "State"}</th>
              <th>Chance</th>
              <th className="num">Favorite</th>
              <th className="rating">Rating</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const odds = chances(r.signal);
              const fav = odds && Object.keys(odds).length ? favoriteOf(odds) : null;
              return (
                <tr key={r.id} className={r.rating === "tossup" ? "watch" : undefined}>
                  <td>
                    <Link href={`/midterms/${r.id}`}>{forecastName(r)}</Link>
                  </td>
                  <td className="chance">{odds && <ChanceBar odds={odds} />}</td>
                  <td className="num" style={fav ? { color: INK[fav.party] } : undefined}>
                    {fav ? `${fav.party} ${Math.round(fav.p * 100)}%` : "—"}
                  </td>
                  <td className="rating">
                    <RatingChip race={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!list.length && <p className="muted small">No races match.</p>}
      {list.length > limit && (
        <button type="button" className="btn secondary small mt-fc-more" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}
