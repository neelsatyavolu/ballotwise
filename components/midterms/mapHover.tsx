// The hover card shared by the tracker's maps. The card follows the pointer by moving its own element, so a map
// redraws only when the pointer reaches another shape or crosses into another half of the map, not on every move.
import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";

/** The shape under the pointer, by key, and where the card opened. `right` and `low` say the pointer is in the map's
 * right or bottom half, so the stylesheet can open the card toward the middle. */
export type HoverAt = { key: string; x: number; y: number; right: boolean; low: boolean };

type Point = { clientX: number; clientY: number };

/** The key of the shape an event landed on: the nearest element with a `data-k`. */
export function keyOf(e: { target: EventTarget }): string | null {
  const el = e.target instanceof Element ? e.target.closest("[data-k]") : null;
  return el?.getAttribute("data-k") ?? null;
}

export function useMapHover(wrap: RefObject<HTMLElement | null>) {
  const [at, setAt] = useState<HoverAt | null>(null);
  const shown = useRef<HoverAt | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const move = useCallback(
    (e: Point, key: string) => {
      const box = wrap.current?.getBoundingClientRect();
      if (!box) return;
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const right = x > box.width / 2;
      const low = y > box.height / 2;
      const was = shown.current;
      if (was && was.key === key && was.right === right && was.low === low && card.current) {
        card.current.style.left = `${x}px`;
        card.current.style.top = `${y}px`;
        return;
      }
      shown.current = { key, x, y, right, low };
      setAt(shown.current);
    },
    [wrap],
  );
  const leave = useCallback(() => {
    if (!shown.current) return;
    shown.current = null;
    setAt(null);
  }, []);
  return { at, card, move, leave };
}

/** The card itself, at the spot `at` opened it; `useMapHover` moves it from there. */
export function HoverCard({ at, card, children }: { at: HoverAt; card: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div ref={card} className="mt-tip" style={{ left: at.x, top: at.y }} data-right={at.right || undefined} data-low={at.low || undefined} role="status">
      {children}
    </div>
  );
}
