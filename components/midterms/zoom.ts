// Shared by the tracker's maps for zooming between view boxes.
import { useEffect, useRef, useState } from "react";

export type Bounds = [number, number, number, number]; // x0, y0, x1, y1
export type Box = [number, number, number, number]; // x, y, width, height

const ZOOM_MS = 450;

/** Bounds padded on every side, as a view box, so a small place still has context around it. */
export function framed([x0, y0, x1, y1]: Bounds): Box {
  const w = x1 - x0;
  const h = y1 - y0;
  const pad = Math.max(w, h) * 0.12 + 4;
  return [x0 - pad, y0 - pad, w + pad * 2, h + pad * 2];
}

/** Bounds of SVG paths written as absolute x,y pairs, as d3-geo writes them. */
export function boundsOf(paths: string[]): Bounds | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const d of paths) {
    for (const [, xs, ys] of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
      const x = Number(xs);
      const y = Number(ys);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

/** `inner` grown about its center to at least `share` of `outer`'s larger side, so a tiny place keeps some of its surroundings. */
export function atLeast(inner: Bounds, outer: Bounds, share: number): Bounds {
  const min = Math.max(outer[2] - outer[0], outer[3] - outer[1]) * share;
  const grow = (lo: number, hi: number): [number, number] => {
    const extra = Math.max(0, min - (hi - lo)) / 2;
    return [lo - extra, hi + extra];
  };
  const [x0, x1] = grow(inner[0], inner[2]);
  const [y0, y1] = grow(inner[1], inner[3]);
  return [x0, y0, x1, y1];
}

/** Animates between two view boxes; the SVG letterboxes to keep the aspect. */
export function useTween(target: Box): Box {
  const [box, setBox] = useState<Box>(target);
  const from = useRef<Box>(target);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ZOOM_MS);
      const e = 1 - (1 - t) ** 3;
      const next = origin.map((v, i) => v + (target[i] - v) * e) as Box;
      from.current = next;
      setBox(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return box;
}
