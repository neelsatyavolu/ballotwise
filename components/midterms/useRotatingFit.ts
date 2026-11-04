"use client";
// Shows a list's items a screenful at a time: only the whole items that fit in its box, and, when they don't all fit,
// the next screenful every ROTATE_MS. The list wraps around, so the screenful after the last items is topped up from
// the first and every screen is full. For card grids on screens nobody scrolls.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** How long each screenful of cards stays up. */
export const ROTATE_MS = 12_000;

/** Which children are up: the first `from` of the rotating ones (after any fixed), how many of those, and of how many. */
type Shown = { from: number; count: number; total: number };

/**
 * Lays out `items` with `fixed` first, always up, and the rest from `start`, wrapping around; hides what doesn't fit
 * below `bottom`. When the fixed ones alone don't all fit, they rotate among themselves and the rest stay hidden.
 */
export function layout(items: readonly HTMLElement[], fixed: number, start: number, bottom: () => number): Shown {
  const pinned = items.slice(0, fixed);
  const rest = items.slice(fixed);
  const place = (ordered: readonly HTMLElement[]) => {
    items.forEach((x) => (x.hidden = true));
    ordered.forEach((x, i) => {
      x.hidden = false;
      x.style.order = String(i);
    });
    const edge = bottom();
    const past = ordered.findIndex((x) => x.getBoundingClientRect().bottom > edge + 1);
    // At least one item shows, even in a box too short for it.
    const count = past < 0 ? ordered.length : Math.max(past, 1);
    ordered.slice(count).forEach((x) => (x.hidden = true));
    return count;
  };
  const from = start < rest.length ? start : 0;
  const count = place([...pinned, ...rest.slice(from), ...rest.slice(0, from)]);
  if (count >= pinned.length) return { from, count: count - pinned.length, total: rest.length };
  // Not even the fixed ones fit: they take turns, and nothing else shows.
  const turn = start < pinned.length ? start : 0;
  return { from: turn, count: place([...pinned.slice(turn), ...pinned.slice(0, turn)]), total: pinned.length };
}

/**
 * Keeps `box`'s children to the ones that fit, starting from the current screenful, and moves on to the next screenful
 * every `ms` (null: never, so only the first screenful shows). The first `fixed` children are always up and never
 * rotated out; the rest take turns in the space left (see layout). `box` must have a fixed height (a flex or grid
 * child with min-height 0), or every child fits. `ready` is false until the box is on the page.
 */
export function useRotatingFit(box: RefObject<HTMLElement | null>, ms: number | null = ROTATE_MS, ready = true, fixed = 0): void {
  const [start, setStart] = useState(0);
  const shown = useRef<Shown>({ from: 0, count: 0, total: 0 });
  const fit = () => {
    const el = box.current;
    if (!el) return;
    // Laid out in turn order with CSS order, so the DOM stays React's.
    shown.current = layout([...el.children] as HTMLElement[], fixed, start, () => el.getBoundingClientRect().bottom);
  };
  // After every render (results change cards' heights) and whenever the box changes size.
  useLayoutEffect(fit);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => fit());
    watch.observe(el);
    return () => watch.disconnect();
    // fit reads the ref and the current screenful; a new screenful re-subscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, start, ready]);
  useEffect(() => {
    if (ms === null) return;
    const t = setInterval(() => {
      const { from, count, total } = shown.current;
      setStart(count >= total ? 0 : (from + count) % total);
    }, ms);
    return () => clearInterval(t);
  }, [ms]);
}
