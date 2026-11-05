// Marks laid over a county map, as DDHQ draws them: a circle per county (Remaining, Margin) or an arrow (Swing).
import type { ReactNode } from "react";
import { boundsOf, type Bounds } from "./zoom";

/** One county's circle: its key, the votes it stands for (votes left, or a lead), and its color. */
export type Bubble = { key: string; size: number; color: string };
/** One county's swing arrow: its key, the shift in points (positive leans left, as a Democratic shift), and its color. */
export type Arrow = { key: string; shift: number; color: string };

/** The biggest circle's radius, as a share of the frame's longer side. */
const BUBBLE_MAX = 0.07;
/** A shift this many points or more draws the longest arrow, as a share of the frame's longer side. */
const ARROW_FULL = 30;
const ARROW_MAX = 0.08;

const middle = (at: Bounds) => ({ x: (at[0] + at[2]) / 2, y: (at[1] + at[3]) / 2 });

/** Circles sized by area, centered on each county in `shapes` (key to path), scaled to `frame`. */
export function bubbleMarks(bubbles: readonly Bubble[], shapes: ReadonlyMap<string, string>, frame: Bounds): ReactNode {
  const most = Math.max(...bubbles.map((b) => b.size));
  if (!(most > 0)) return null;
  const reach = Math.max(frame[2] - frame[0], frame[3] - frame[1]) * BUBBLE_MAX;
  const placed = bubbles.flatMap((b) => {
    const d = shapes.get(b.key);
    const at = d && boundsOf([d]);
    return at ? [{ ...b, ...middle(at), r: reach * Math.sqrt(b.size / most) }] : [];
  });
  // Biggest first, so a small county's circle sits on top of a big neighbor's.
  return (
    <g className="mt-bubbles" pointerEvents="none">
      {placed.sort((a, b) => b.r - a.r).map((b) => <circle key={b.key} cx={b.x} cy={b.y} r={b.r} style={{ fill: b.color }} vectorEffect="non-scaling-stroke" />)}
    </g>
  );
}

/** Arrows centered on each county in `shapes`, longer for a bigger shift, scaled to `frame`. */
export function arrowMarks(arrows: readonly Arrow[], shapes: ReadonlyMap<string, string>, frame: Bounds): ReactNode {
  const side = Math.max(frame[2] - frame[0], frame[3] - frame[1]);
  const width = side * 0.006;
  const drawn = arrows.flatMap((a) => {
    const d = shapes.get(a.key);
    const at = d && boundsOf([d]);
    const length = side * ARROW_MAX * Math.min(1, Math.abs(a.shift) / ARROW_FULL);
    if (!at || length < width * 2) return [];
    // Up and to the left for a shift toward the Democrat, up and to the right toward the Republican, as DDHQ draws them.
    const dx = (a.shift > 0 ? -1 : 1) * Math.cos(Math.PI / 6);
    const dy = -Math.sin(Math.PI / 6);
    const { x: cx, y: cy } = middle(at);
    const head = Math.max(width * 3, length * 0.35);
    const tip = { x: cx + (dx * length) / 2, y: cy + (dy * length) / 2 };
    const base = { x: tip.x - dx * head, y: tip.y - dy * head };
    const wing = head * 0.55;
    const points = `${tip.x},${tip.y} ${base.x - dy * wing},${base.y + dx * wing} ${base.x + dy * wing},${base.y - dx * wing}`;
    return [
      <g key={a.key} style={{ color: a.color }}>
        <line x1={cx - (dx * length) / 2} y1={cy - (dy * length) / 2} x2={base.x} y2={base.y} strokeWidth={width} />
        <polygon points={points} />
      </g>,
    ];
  });
  return (
    <g className="mt-arrows" pointerEvents="none">
      {drawn}
    </g>
  );
}
