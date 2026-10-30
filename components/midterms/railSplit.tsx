// Rendered inside election mode: lets its race list use the full page width once the side rail ends.
import { createContext, useContext, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Election mode's side rail (map, calls, poll closings) and the full-width slot under the layout where cards past it go. */
export type Rail = { boxes: HTMLElement[]; slot: HTMLElement | null };
export const RailContext = createContext<Rail>({ boxes: [], slot: null });

/** Below this width the rail stacks under the list, so nothing is split. */
const WIDE = "(min-width: 1001px)";

/**
 * How many of a list's rendered items sit beside the rail; the rest go to the full-width slot. Null means all of
 * them (while measuring, on narrow screens, or with no rail). A change to `version` or to the rail's size starts
 * over: every item goes beside the rail, and the ones whose middle falls below the rail's end move out before the
 * browser paints.
 */
export function useRailSplit(list: RefObject<HTMLElement | null>, version: string): number | null {
  const { boxes } = useContext(RailContext);
  const [resized, setResized] = useState(0);
  const [measured, setMeasured] = useState<{ for: string; split: number | null } | null>(null);
  const current = `${version}|${resized}|${boxes.length}`;
  const split = measured?.for === current ? measured.split : null;

  useEffect(() => {
    if (!boxes.length) return;
    const watch = new ResizeObserver(() => setResized((n) => n + 1));
    for (const b of boxes) watch.observe(b);
    return () => watch.disconnect();
  }, [boxes]);

  useLayoutEffect(() => {
    if (measured?.for === current || !list.current) return;
    let next: number | null = null;
    if (boxes.length && matchMedia(WIDE).matches) {
      const end = Math.max(...boxes.map((b) => b.getBoundingClientRect().bottom));
      const first = [...list.current.children].findIndex((el) => {
        const r = el.getBoundingClientRect();
        return (r.top + r.bottom) / 2 > end;
      });
      next = first === -1 ? null : first;
    }
    // Measuring the laid-out page has to happen after layout and before paint, so this state update is the point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMeasured({ for: current, split: next });
  }, [measured, current, boxes, list]);

  return split;
}
