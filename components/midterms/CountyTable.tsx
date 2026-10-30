// Rendered inside RaceView.
import { useMemo, useState } from "react";
import { clockNow } from "@/lib/midterms/clock";
import { stateFinal } from "@/lib/midterms/polls";
import type { CountyResult, RaceDetail } from "@/lib/midterms/races";
import { fmt, lead, marginLabel, pct, twoWay } from "@/lib/midterms/view";
import { partyColor } from "./party";

type Key = "name" | "leader" | "total" | "reporting" | "out" | "margin" | "baseline" | "shift";
type Row = CountyResult & { margin: number | null; shift: number | null; out: number | null };

const HEADS: { key: Key; label: string; title?: string }[] = [
  { key: "name", label: "County" },
  { key: "leader", label: "Leader" },
  { key: "total", label: "Votes" },
  { key: "reporting", label: "Reported" },
  { key: "out", label: "Below 2024", title: "The county's 2024 presidential vote minus the votes counted so far. A rough sign of where votes may remain, not an estimate of them." },
  { key: "margin", label: "Margin", title: "Democratic minus Republican share (or Yes minus No)" },
  { key: "baseline", label: "2024 pres.", title: "2024 presidential margin in this county" },
  { key: "shift", label: "Shift", title: "This race's margin minus the 2024 presidential margin" },
];

function value(row: Row, key: Key): number | string {
  if (key === "name") return row.name;
  if (key === "leader") return lead(row.candidates)?.leader.name ?? "";
  if (key === "total") return row.total;
  if (key === "reporting") return row.reporting;
  if (key === "out") return row.out ?? -Infinity;
  if (key === "margin") return row.margin ?? -Infinity;
  if (key === "baseline") return row.baseline2024 ?? -Infinity;
  return row.shift ?? -Infinity;
}

/** Every county (or town) with its count, margin, and how it moved from 2024. Sortable and searchable. */
export function CountyTable({ race, selected, onSelect }: { race: RaceDetail; selected: string | null; onSelect: (fips: string | null) => void }) {
  const [query, setQuery] = useState("");
  const partisan = race.office !== "measure";
  // Against whole-county 2024 totals only for statewide races: a House district covers parts of counties.
  const statewide = race.office !== "house" && race.counties.some((c) => c.pres2024);
  // Once the state's polls have closed, the counties furthest below their 2024 vote come first.
  const closed = (stateFinal(race.state) ?? Infinity) <= clockNow();
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: statewide && closed ? "out" : "total", desc: true });
  const unit = race.counties.some((c) => c.fips) ? "county" : "town";

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: Row[] = race.counties
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => {
        const margin = c.total ? twoWay(c.candidates) : null;
        return {
          ...c,
          margin,
          shift: margin !== null && c.baseline2024 !== null && partisan ? margin - c.baseline2024 : null,
          out: statewide && c.pres2024 ? Math.max(0, c.pres2024.total - c.total) : null,
        };
      });
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      return (typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number)) * dir;
    });
  }, [race, query, sort, partisan, statewide]);

  const heads = HEADS.filter((h) => (partisan || (h.key !== "baseline" && h.key !== "shift")) && (statewide || (h.key !== "out" && h.key !== "shift")));
  const pick = (r: Row) => r.fips && onSelect(r.fips === selected ? null : r.fips);

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
                <tr
                  key={r.fips ?? r.name}
                  className={r.fips && r.fips === selected ? "selected" : undefined}
                  aria-current={r.fips && r.fips === selected ? "true" : undefined}
                  tabIndex={r.fips ? 0 : undefined}
                  onClick={() => pick(r)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    pick(r);
                  }}
                >
                  <td>{r.name}</td>
                  <td>
                    {ahead ? (
                      <>
                        <span className="swatch" style={{ background: partyColor(ahead.leader) }} aria-hidden /> {ahead.leader.name} {pct(ahead.leader.pct)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">{fmt(r.total)}</td>
                  <td className="num" title={r.reportingUnknown ? "This county has votes but no reporting figure" : undefined}>
                    <span className="mt-share small-bar">
                      <span style={{ width: `${r.reportingUnknown ? 0 : r.reporting}%`, background: "var(--accent)" }} />
                    </span>
                    {r.reportingUnknown ? "n/a" : `${Math.round(r.reporting)}%`}
                  </td>
                  {statewide && <td className="num">{r.out === null ? "—" : fmt(r.out)}</td>}
                  <td className="num">{r.margin === null ? "—" : partisan ? marginLabel(r.margin) : `${r.margin > 0 ? "Yes" : "No"} +${Math.abs(r.margin).toFixed(1)}`}</td>
                  {partisan && <td className="num">{r.baseline2024 === null ? "—" : marginLabel(r.baseline2024)}</td>}
                  {partisan && statewide && <td className="num">{r.shift === null ? "—" : marginLabel(r.shift)}</td>}
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
