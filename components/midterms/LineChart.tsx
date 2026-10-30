// Rendered inside the tracker's client components: the market, forecast and polling charts.
import { useState, type PointerEvent } from "react";

/** A point: [unix seconds, value]. */
export type ChartPoint = readonly [number, number];
export type ChartLine = { name: string; color: string; dash?: string; points: readonly ChartPoint[] };

// Default chart box in SVG units; the SVG scales to the panel's width, so a wide panel passes a wider `size`
// to keep the labels at their normal size.
const SIZE = { w: 560, h: 190 };
const PAD = { left: 52, right: 8, top: 8, bottom: 24 };

/** The point at or just before `t`. */
function at(points: readonly ChartPoint[], t: number): ChartPoint | null {
  let found: ChartPoint | null = null;
  for (const p of points) {
    if (p[0] > t) break;
    found = p;
  }
  return found;
}

/** A value range that holds every point with a little room, on whole steps of `step`. */
function autoDomain(values: readonly number[], step: number): [number, number] {
  const lo = Math.floor((Math.min(...values) - step / 2) / step) * step;
  const hi = Math.ceil((Math.max(...values) + step / 2) / step) * step;
  return [lo, hi === lo ? lo + step : hi];
}

/**
 * Lines over time with gridlines at `ticks`, the first and last dates, and a crosshair whose card lists each line's
 * value at that date. `domain` "auto" fits the values, rounded to `step`.
 */
export function LineChart({ lines, domain = [0, 1], ticks, step = 5, value, date, label, empty, marker, size = SIZE }: { size?: { w: number; h: number }; lines: readonly ChartLine[]; domain?: [number, number] | "auto"; ticks?: readonly number[]; step?: number; value: (v: number) => string; date: (t: number) => string; label: string; empty: string; marker?: { t: number; label: string } }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const { w: W, h: H } = size;
  const all = lines.flatMap((l) => l.points);
  if (all.length < 2) return <p className="muted small mt-mk-empty">{empty}</p>;
  const times = all.map((p) => p[0]);
  const [lo, hi] = domain === "auto" ? autoDomain(all.map((p) => p[1]), step) : domain;
  const marks = ticks ?? [lo, (lo + hi) / 2, hi];
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  function move(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const ratio = Math.min(1, Math.max(0, (sx - PAD.left) / (W - PAD.left - PAD.right)));
    setHoverT(t0 + ratio * (t1 - t0));
  }
  const values = hoverT === null ? [] : lines.map((l) => ({ l, v: at(l.points, hoverT)?.[1] ?? null })).filter((v) => v.v !== null).sort((a, b) => b.v! - a.v!);

  return (
    <div className="mt-mk-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={move} onPointerLeave={() => setHoverT(null)}>
        {marks.map((g) => (
          <g key={g}>
            <line className="mt-mk-grid" x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} />
            <text className="mt-mk-axis" x={PAD.left - 6} y={y(g)} textAnchor="end" dominantBaseline="middle">
              {value(g)}
            </text>
          </g>
        ))}
        <text className="mt-mk-axis" x={PAD.left} y={H - 4} textAnchor="start">{date(t0)}</text>
        <text className="mt-mk-axis" x={W - PAD.right} y={H - 4} textAnchor="end">{date(t1)}</text>
        {lines.map((l) => (
          <polyline key={l.name} className="mt-mk-line" points={l.points.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ")} style={{ stroke: l.color }} strokeDasharray={l.dash} />
        ))}
        {marker && marker.t > t0 && marker.t <= t1 && (
          <g className="mt-mk-marker">
            <line x1={x(marker.t)} x2={x(marker.t)} y1={PAD.top} y2={H - PAD.bottom} />
            <text x={x(marker.t) - 4} y={PAD.top + 10} textAnchor="end">{marker.label}</text>
          </g>
        )}
        {hoverT !== null && <line className="mt-mk-cross" x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={H - PAD.bottom} />}
      </svg>
      {hoverT !== null && values.length > 0 && (
        // Opens away from the nearer edge, so it never runs off the card and hides the values.
        <div className="mt-mk-tip" style={{ left: `${(x(hoverT) / W) * 100}%`, transform: x(hoverT) / W > 0.5 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }} role="status">
          <b>{date(hoverT)}</b>
          {values.map(({ l, v }) => (
            <div key={l.name}>
              <i style={{ background: l.color }} /> {l.name} <span>{value(v!)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
