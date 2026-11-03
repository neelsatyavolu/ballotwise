"use client";
// Shows a list's items a screenful at a time: only the whole items that fit in its box, and, when they don't all fit,
// the next screenful every ROTATE_MS, back to the first after the last. For card grids on screens nobody scrolls.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** How long each screenful of cards stays up. */
export const ROTATE_MS = 12_000;

/**
 * Keeps `box`'s children to the ones that fit, starting from the current screenful, and moves on to the next screenful
 * every `ms` (null: never, so only the first screenful shows). `box` must have a fixed height (a flex or grid child
 * with min-height 0), or every child fits. `ready` is false until the box is on the page.
 */
export function useRotatingFit(box: RefObject<HTMLElement | null>, ms: number | null = ROTATE_MS, ready = true): void {
  const [start, setStart] = useState(0);
  const shown = useRef({ from: 0, count: 0, total: 0 });
  const fit = () => {
    const el = box.current;
    if (!el) return;
    const items = [...el.children] as HTMLElement[];
    const from = start < items.length ? start : 0;
    items.forEach((x, i) => (x.hidden = i < from));
    const bottom = el.getBoundingClientRect().bottom;
    const past = items.findIndex((x, i) => i >= from && x.getBoundingClientRect().bottom > bottom + 1);
    // At least one item shows, even in a box too short for it.
    const end = past < 0 ? items.length : Math.max(past, from + 1);
    items.slice(end).forEach((x) => (x.hidden = true));
    shown.current = { from, count: end - from, total: items.length };
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
      if (count >= total) setStart(0);
      else setStart(from + count >= total ? 0 : from + count);
    }, ms);
    return () => clearInterval(t);
  }, [ms]);
}
