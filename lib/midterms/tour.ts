// Geometry for the overview's first-visit tour, kept free of React so it can be tested on its own.

export type Box = { top: number; left: number; width: number; height: number };
type Size = { w: number; h: number };

/** Space between the highlighted part of the page and the step's card. */
const GAP = 12;
/** The card never comes closer than this to the screen's edges. */
const GUTTER = 16;
/** How far the highlight reaches past the part of the page it marks. */
const PAD = 6;

/**
 * Where a step's card goes: under its target, lined up with the target's left edge, or above it when there's no
 * room below. A target too tall for either (the desktop map) gets the card beside it, level with its top; one that
 * fills the screen (a phone's map) gets it pinned to the bottom of the screen.
 */
export function placeCard(target: Box, card: Size, viewport: Size): { top: number; left: number; side: "below" | "above" | "right" | "left" | "pinned" } {
  const left = Math.max(GUTTER, Math.min(target.left, viewport.w - card.w - GUTTER));
  const below = target.top + target.height + GAP;
  if (below + card.h <= viewport.h - GUTTER) return { top: below, left, side: "below" };
  const above = target.top - GAP - card.h;
  if (above >= GUTTER) return { top: above, left, side: "above" };
  const level = Math.max(GUTTER, Math.min(target.top, viewport.h - card.h - GUTTER));
  const right = target.left + target.width + GAP;
  if (right + card.w <= viewport.w - GUTTER) return { top: level, left: right, side: "right" };
  const beside = target.left - GAP - card.w;
  if (beside >= GUTTER) return { top: level, left: beside, side: "left" };
  return { top: viewport.h - card.h - GUTTER, left, side: "pinned" };
}

/** The highlight around a target: padded a little, and trimmed to the screen so a tall target's stays in view. */
export function spotlight(target: Box, viewport: Size): Box {
  const top = Math.max(0, target.top - PAD);
  const left = Math.max(0, target.left - PAD);
  const bottom = Math.min(viewport.h, target.top + target.height + PAD);
  const right = Math.min(viewport.w, target.left + target.width + PAD);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
