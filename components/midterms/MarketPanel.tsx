"use client";

import { useMemo, useState, type PointerEvent } from "react";
import type { Line, MarketBook, Point, RaceMarkets } from "@/lib/midterms/marketHistory";
import { useLive } from "./hooks";

type Source = "polymarket" | "kalshi";
type Range = "all" | "live";
const SOURCE_LABEL: Record<Source, string> = { polymarket: "Polymarket", kalshi: "Kalshi" };

// Chart box in SVG units; the SVG scales to the panel's width.
const W = 560;
const H = 190;
const PAD = { left: 52, right: 8, top: 8, bottom: 24 };
/** Brighter party hues for 2px lines on the dark card (the base party colors fall under 3:1 there). */
const LINE_COLOR = { D: "var(--dem-ink)", R: "var(--rep-ink)", I: "var(--oth)" } as const;
/** An outcome with no known party, such as someone who lost the primary but still trades: neutral, not "independent". */
const NO_PARTY = "var(--muted)";

const pct = (p: number) => `${(p * 100).toFixed(2)}%`;
const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const hour = (t: number) => new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });

/** Each line's color, and a dash for a second candidate of the same party, so no two lines look alike. */
function styles(lines: readonly Line[]) {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const color = l.side ? LINE_COLOR[l.side] : NO_PARTY;
    const n = seen.get(color) ?? 0;
    seen.set(color, n + 1);
    return { color, dash: n === 0 ? undefined : n === 1 ? "6 4" : "2 3" };
  });
}

/** The point at or just before `t`. */
function at(points: readonly Point[], t: number): Point | null {
  let found: Point | null = null;
  for (const p of points) {
    if (p[0] > t) break;
    found = p;
  }
  return found;
}

function Chart({ lines, range }: { lines: readonly Line[]; range: Range }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const series = lines.map((l) => (range === "all" ? l.all : l.live));
  const times = series.flat().map((p) => p[0]);
  const look = styles(lines);
  if (!times.length) return <p className="muted small mt-mk-empty">No trades {range === "live" ? "in the last two days" : "yet"}.</p>;
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - p) * (H - PAD.top - PAD.bottom);
  const fmt = range === "all" ? day : hour;

  function move(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const ratio = Math.min(1, Math.max(0, (sx - PAD.left) / (W - PAD.left - PAD.right)));
    setHoverT(t0 + ratio * (t1 - t0));
  }
  const values = hoverT === null ? [] : lines.map((l, i) => ({ l, i, p: at(series[i], hoverT)?.[1] ?? null })).filter((v) => v.p !== null).sort((a, b) => b.p! - a.p!);

  return (
    <div className="mt-mk-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price history: ${lines.map((l) => `${l.name} ${pct(l.now)}`).join(", ")}`} onPointerMove={move} onPointerLeave={() => setHoverT(null)}>
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line className="mt-mk-grid" x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} />
            <text className="mt-mk-axis" x={PAD.left - 6} y={y(g)} textAnchor="end" dominantBaseline="middle">{g * 100}%</text>
          </g>
        ))}
        <text className="mt-mk-axis" x={PAD.left} y={H - 4} textAnchor="start">{fmt(t0)}</text>
        <text className="mt-mk-axis" x={W - PAD.right} y={H - 4} textAnchor="end">{fmt(t1)}</text>
        {series.map((pts, i) => (
          <polyline key={lines[i].name} className="mt-mk-line" points={pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ")} style={{ stroke: look[i].color }} strokeDasharray={look[i].dash} />
        ))}
        {hoverT !== null && <line className="mt-mk-cross" x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={H - PAD.bottom} />}
      </svg>
      {hoverT !== null && values.length > 0 && (
        <div className="mt-mk-tip" style={{ left: `${(x(hoverT) / W) * 100}%` }} role="status">
          <b>{fmt(hoverT)}</b>
          {values.map(({ l, i, p }) => (
            <div key={l.name}>
              <i style={{ background: look[i].color }} /> {l.name} <span>{pct(p!)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Book({ book, range, setRange }: { book: MarketBook; range: Range; setRange: (r: Range) => void }) {
  const lead = book.lines[0];
  const look = styles(book.lines);
  return (
    <div className="mt-mk-card">
      <div className="mt-mk-top">
        <p className="mt-mk-q">{book.question}</p>
        <div className="mt-seg" role="group" aria-label="Time range">
          {(["all", "live"] as const).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} title={r === "all" ? "Since the market opened" : "The last two days"}>
              {r === "all" ? "All" : "Live"}
            </button>
          ))}
        </div>
      </div>
      {lead && <p className="mt-mk-lead">{lead.name} {pct(lead.now)}</p>}
      <Chart lines={book.lines} range={range} />
      <ul className="mt-mk-legend">
        {book.lines.map((l, i) => (
          <li key={l.name}>
            <svg width="16" height="8" aria-hidden><line x1="0" x2="16" y1="4" y2="4" style={{ stroke: look[i].color }} strokeWidth="2" strokeDasharray={look[i].dash} /></svg>
            {l.name} <span>{pct(l.now)}</span>
          </li>
        ))}
      </ul>
      <a className="mt-mk-src small" href={book.url} target="_blank" rel="noreferrer">See this market →</a>
    </div>
  );
}

/** Prediction-market prices for one race over time, from Polymarket or Kalshi; nothing at all when neither lists it. */
export function MarketPanel({ raceId }: { raceId: number }) {
  const { data } = useLive<RaceMarkets>(`/api/midterms/race/${raceId}/markets`);
  const sources = useMemo(() => (["polymarket", "kalshi"] as const).filter((s) => data?.[s]?.lines.length), [data]);
  const [picked, setPicked] = useState<Source | null>(null);
  const [range, setRange] = useState<Range>("all");
  if (!data || !sources.length) return null;
  const source = picked && sources.includes(picked) ? picked : sources[0];
  return (
    <section className="mt-mk" aria-label="Prediction markets">
      <h3 className="mt-mk-head">Markets</h3>
      <div className="mt-seg mt-mk-sources" role="group" aria-label="Market">
        {sources.map((s) => (
          <button key={s} type="button" aria-pressed={source === s} onClick={() => setPicked(s)}>
            {SOURCE_LABEL[s]}
          </button>
        ))}
      </div>
      <Book book={data[source]!} range={range} setRange={setRange} />
    </section>
  );
}
