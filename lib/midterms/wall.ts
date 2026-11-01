// A wall screen: one office's results for a TV or spare monitor across the room. It sizes its type to the screen and
// its map tours the closest races on its own. Kept free of the browser so the rules can be tested on their own.
import { closestFirst, isCompetitive, isWatch } from "./explore";
import type { Office, RaceSummary } from "./view";

/** How long the map stays on the whole country, and on each race it zooms into. */
export const NATION_MS = 15_000;
export const RACE_MS = 12_000;
/** The most races one trip around the tour visits, so it comes back to the start within a few minutes. */
const MAX_TOUR = 12;
/** The map returns to the whole country after this many races. */
const RACES_PER_LEG = 3;

/**
 * The races the map zooms into: this office's uncalled toss-ups, then its uncalled leans, closest first. Once every
 * one of those is called, the closest of the office's races with votes counted, so the map still has results to show.
 */
export function tourRaces(races: readonly RaceSummary[], office: Office): RaceSummary[] {
  const mine = races.filter((r) => r.office === office);
  const open = mine.filter((r) => isWatch(r) || isCompetitive(r));
  return (open.length ? open : mine.filter((r) => r.total > 0)).sort(closestFirst).slice(0, MAX_TOUR);
}

/** The tour's stops: null is the whole country, shown first and again after every few races. */
export function tourStops(raceIds: readonly number[]): (number | null)[] {
  const stops: (number | null)[] = [];
  raceIds.forEach((id, i) => {
    if (i % RACES_PER_LEG === 0) stops.push(null);
    stops.push(id);
  });
  return stops.length ? stops : [null];
}

/** Below this width the wall draws at normal size; wider screens get proportionally bigger type, up to MAX_AUTO. */
const BASE_WIDTH = 1600;
const MAX_AUTO = 3;
const round = (n: number) => Math.round(n * 10) / 10;

/** How much bigger than normal to draw the wall on a window this many CSS pixels wide. */
export function autoScale(width: number): number {
  return round(Math.min(MAX_AUTO, Math.max(1, width / BASE_WIDTH)));
}

/** The viewer's own adjustment on top of autoScale, after pressing +, - or 0 (back to 1). */
export function nextScale(current: number, key: "+" | "-" | "0"): number {
  if (key === "0") return 1;
  return round(Math.max(0.5, current + (key === "+" ? 0.1 : -0.1)));
}
