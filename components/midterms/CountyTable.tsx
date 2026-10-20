// Rendered inside RaceView.
import { useMemo, useState } from "react";
import type { CountyResult, RaceDetail } from "@/lib/midterms/races";
import { colorOf, fmt, lead, marginLabel, pct, twoWay } from "@/lib/midterms/view";

type Key = "name" | "leader" | "total" | "reporting" | "margin" | "baseline" | "shift";
type Row = CountyResult & { margin: number | null; shift: number | null };

const HEADS: { key: Key; label: string; title?: string }[] = [
  { key: "name", label: "County" },
  { key: "leader", label: "Leader" },
  { key: "total", label: "Votes" },
  { key: "reporting", label: "Reported" },
  { key: "margin", label: "Margin", title: "Democratic minus Republican share (or Yes minus No)" },
  { key: "baseline", label: "2024 pres.", title: "2024 presidential margin in this county" },
  { key: "shift", label: "Shift", title: "This race's margin minus the 2024 presidential margin" },
];

function value(row: Row, key: Key): number | string {
  if (key === "name") return row.name;
  if (key === "leader") return lead(row.candidates)?.leader.name ?? "";
  if (key === "total") return row.total;
  if (key === "reporting") return row.reporting;
  if (key === "margin") return row.margin ?? -Infinity;
  if (key === "baseline") return row.baseline2024 ?? -Infinity;
  return row.shift ?? -Infinity;
}

/** Every county (or town) with its count, margin, and how it moved from 2024. Sortable and searchable. */
export function CountyTable({ race, selected, onSelect }: { race: RaceDetail; selected: string | null; onSelect: (fips: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "total", desc: true });
  const partisan = race.office !== "measure";
  const unit = race.counties.some((c) => c.fips) ? "county" : "town";

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: Row[] = race.counties
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => {
        const margin = c.total ? twoWay(c.candidates) : null;
        return { ...c, margin, shift: margin !== null && c.baseline2024 !== null && partisan ? margin - c.baseline2024 : null };
      });
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      return (typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number)) * dir;
    });
  }, [race, query, sort, partisan]);

  const heads = HEADS.filter((h) => partisan || (h.key !== "baseline" && h.key !== "shift"));

  return (
    <section className="mt-counties" aria-labelledby="county-table">
      <div className="mt-section-head">
        <h2 id="county-table">{unit === "county" ? "Results by county" : "Results by town"}</h2>
        <input className="input mt-search" type="search" placeholder={`Find a ${unit}`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Find a ${unit}`} />
      </div>
      <div className="mt-scroll">
        <table className="mt-table">
          <thead>
            <tr>
              {heads.map((h) => (
                <th key={h.key} className={h.key === "name" || h.key === "leader" ? undefined : "num"} title={h.title} aria-sort={sort.key === h.key ? (sort.desc ? "descending" : "ascending") : undefined}>
                  <button type="button" onClick={() => setSort((s) => ({ key: h.key, desc: s.key === h.key ? !s.desc : h.key !== "name" && h.key !== "leader" }))}>
                    {h.key === "name" ? (unit === "county" ? "County" : "Town") : h.label}
                    {sort.key === h.key ? (sort.desc ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ahead = lead(r.candidates);
              return (
                <tr key={r.fips ?? r.name} className={r.fips && r.fips === selected ? "selected" : undefined} onClick={() => r.fips && onSelect(r.fips === selected ? null : r.fips)}>
                  <td>{r.name}</td>
                  <td>
                    {ahead ? (
                      <>
                        <span className="swatch" style={{ background: colorOf(ahead.leader) }} aria-hidden /> {ahead.leader.name} {pct(ahead.leader.pct)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">{fmt(r.total)}</td>
                  <td className="num">
                    <span className="mt-share small-bar">
                      <span style={{ width: `${r.reporting}%`, background: "var(--accent)" }} />
                    </span>
                    {Math.round(r.reporting)}%
                  </td>
                  <td className="num">{r.margin === null ? "—" : partisan ? marginLabel(r.margin) : `${r.margin > 0 ? "Yes" : "No"} +${Math.abs(r.margin).toFixed(1)}`}</td>
                  {partisan && <td className="num">{r.baseline2024 === null ? "—" : marginLabel(r.baseline2024)}</td>}
                  {partisan && <td className="num">{r.shift === null ? "—" : marginLabel(r.shift)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted small">No {unit} matches “{query}”.</p>}
    </section>
  );
}
