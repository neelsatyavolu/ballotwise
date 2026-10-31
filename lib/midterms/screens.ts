// Two screens on election night: an ultrawide with the tracker and a laptop beside it, say. Every open tracker tab
// says what it shows; the biggest visible window is the main screen, and a smaller visible one becomes its companion,
// showing what the main screen can't. Kept free of the browser so the rules can be tested on their own.
import type { Mock } from "./clock";

/** The election-night panels a companion can show, in the order it shows them. */
export const PANELS = ["control", "tossups", "calls", "schedule"] as const;
export type Panel = (typeof PANELS)[number];

/** One tab's report: who it is, whether it's on screen, how big its window is and which panels it shows. */
export type Screen = {
  id: string;
  startedAt: number;
  /** When this report was made; reports older than EXPIRE_MS are from closed or sleeping tabs. */
  at: number;
  visible: boolean;
  /** Window area in CSS pixels: the bigger window is the main screen. */
  area: number;
  /** The panels wholly on screen: not cut off by the window's edge or scrolled out of sight. */
  panels: readonly Panel[];
  /** The toss-up races whose cards are on screen, so a companion shows only the rest. */
  seen: readonly number[];
  /** The viewer asked this tab never to become a companion. */
  solo: boolean;
  /** The mock election night running in this tab, if any, so a companion can run the same one. */
  mock: Mock | null;
};

export type Role = "solo" | "main" | "companion";

/** Tabs report every couple of seconds; one silent for this long is gone. */
export const EXPIRE_MS = 6_000;

/** The main screen first: biggest window, then the tab opened first, then by id so every tab agrees. */
const rank = (a: Screen, b: Screen) => b.area - a.area || a.startedAt - b.startedAt || a.id.localeCompare(b.id);

/**
 * This tab's part. Only visible tabs count, so two tabs in one window (only one showing at a time) never pair up.
 * The biggest visible window is main; any other visible tab is its companion unless it asked to stay solo. A main
 * screen with no companion is solo.
 */
export function roleOf(self: Screen, others: readonly Screen[], now: number): { role: Role; main: Screen | null } {
  if (!self.visible) return { role: "solo", main: null };
  const live = [self, ...others.filter((s) => s.id !== self.id && s.visible && now - s.at < EXPIRE_MS)].sort(rank);
  const main = live[0];
  if (main.id !== self.id) return self.solo ? { role: "solo", main: null } : { role: "companion", main };
  return { role: live.some((s) => s.id !== self.id && !s.solo) ? "main" : "solo", main: null };
}

/** What a companion shows: every panel the main screen doesn't. */
export function hiddenOn(main: Screen): Panel[] {
  return PANELS.filter((p) => !main.panels.includes(p));
}

/** A companion's toss-up tiles: how many columns and rows, and how wide each tile's map can be drawn, in pixels. */
export type TileGrid = { cols: number; rows: number; map: number };

/**
 * The grid for `n` tiles, each a results card over a county map, that draws the maps biggest in a `width` × `height`
 * box: each map gets its tile's width, or the height left under the card times `aspect`, whichever is smaller.
 */
export function tileGrid(n: number, width: number, height: number, { gap, card, aspect }: { gap: number; card: number; aspect: number }): TileGrid {
  let best: TileGrid = { cols: 1, rows: n, map: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (width - gap * (cols - 1)) / cols;
    const h = (height - gap * (rows - 1)) / rows;
    const map = Math.max(0, Math.min(w, (h - card) * aspect));
    if (map > best.map) best = { cols, rows, map };
  }
  return best;
}
