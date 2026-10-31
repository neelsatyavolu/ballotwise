// Where a state's postal label goes on the nation map.

type Point = [number, number];

/** States whose outline is smaller than this (in map units) are left unlabeled, as DDHQ does in the Northeast; Hawaii is labeled anyway. */
const MIN_LABEL_AREA = 2000;
const ALWAYS_LABELED = new Set(["HI"]);
/** Samples per side of the grid laid over a state, and how deep a sample must be, against the deepest, to count as its thick part. */
const GRID = 24;
const CORE = 0.5;
/** Outlines are thinned to about this many points first: coastlines carry far more detail than a label needs. */
const MAX_POINTS = 120;

function rings(d: string): Point[][] {
  return d
    .split("M")
    .slice(1)
    .map((ring) => ring.replace(/Z/gi, "").split("L").map((p) => p.split(",").map(Number) as Point));
}

function area(pts: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
}

function inside([x, y]: Point, pts: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDistance([x, y]: Point, pts: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}

/**
 * The middle of an outline's thick part: of the points at least half as far from the edge as the deepest one, the one
 * nearest their average. A thin arm can't pull it aside (Florida's panhandle drags its centroid onto the Gulf), and
 * it stays central where the single deepest point would not (Florida's is down by Lake Okeechobee).
 */
function middle(outline: readonly Point[]): Point {
  const step = Math.ceil(outline.length / MAX_POINTS);
  const pts = outline.filter((_, i) => i % step === 0);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const samples: { at: Point; d: number }[] = [];
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      const at: Point = [x0 + ((x1 - x0) * i) / GRID, y0 + ((y1 - y0) * j) / GRID];
      if (inside(at, pts)) samples.push({ at, d: edgeDistance(at, pts) });
    }
  }
  if (!samples.length) return [(x0 + x1) / 2, (y0 + y1) / 2];
  const deepest = Math.max(...samples.map((s) => s.d));
  const core = samples.filter((s) => s.d >= deepest * CORE);
  const mx = core.reduce((sum, s) => sum + s.at[0], 0) / core.length;
  const my = core.reduce((sum, s) => sum + s.at[1], 0) / core.length;
  const off = (s: { at: Point }) => Math.hypot(s.at[0] - mx, s.at[1] - my);
  return core.reduce((best, s) => (off(s) < off(best) ? s : best)).at;
}

/** Where a state's postal label goes: the middle of its largest outline's thick part, or null when it's too small for one. */
export function labelSpot(state: string, d: string): Point | null {
  const largest = rings(d).reduce<{ pts: Point[]; area: number } | null>((best, pts) => {
    const a = area(pts);
    return !best || a > best.area ? { pts, area: a } : best;
  }, null);
  if (!largest || !largest.area || (largest.area < MIN_LABEL_AREA && !ALWAYS_LABELED.has(state))) return null;
  return middle(largest.pts);
}
