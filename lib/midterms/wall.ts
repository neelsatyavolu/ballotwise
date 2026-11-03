// A wall screen: one office's results for a TV or spare monitor across the room. It sizes its type to the screen and
// its map tours the closest races on its own. Kept free of the browser so the rules can be tested on their own.
import { closestFirst, isCompetitive, isWatch } from "./explore";
import type { Office, RaceSummary } from "./view";

/** The most races one trip around the tour visits, so it comes back to the start within a few minutes. */
const MAX_TOUR = 12;

/**
 * How each office's tour moves: how long it stays on the whole country and on each race, and after how many races
 * it goes back to the whole country. A null `racesPerLeg` never leaves it: the map stays on the whole country with
 * the race marked, and only the race card changes.
 */
export type TourPlan = { nationMs: number; raceMs: number; racesPerLeg: number | null };
export const TOUR: Record<"senate" | "house", TourPlan> = {
  // The country (who's on track for 51) is up two thirds of the time, between single states zoomed to their counties.
  senate: { nationMs: 24_000, raceMs: 12_000, racesPerLeg: 1 },
  // The country, then the three toss-ups its "up next" cards show, each zoomed to its state's districts.
  house: { nationMs: 16_000, raceMs: 10_000, racesPerLeg: 3 },
};

/**
 * The races the map zooms into: this office's uncalled toss-ups, then its uncalled leans, closest first. Once every
 * one of those is called, the closest of the office's races with votes counted, so the map still has results to show.
 */
export function tourRaces(races: readonly RaceSummary[], office: Office): RaceSummary[] {
  const mine = races.filter((r) => r.office === office);
  const open = mine.filter((r) => isWatch(r) || isCompetitive(r));
  return (open.length ? open : mine.filter((r) => r.total > 0)).sort(closestFirst).slice(0, MAX_TOUR);
}

/** The tour's stops: null is the whole country, shown first and again after every `racesPerLeg` races (never when null). */
export function tourStops(raceIds: readonly number[], racesPerLeg: number | null): (number | null)[] {
  const stops = raceIds.flatMap((id, i) => (racesPerLeg !== null && i % racesPerLeg === 0 ? [null, id] : [id]));
  return stops.length ? stops : [null];
}

/**
 * Within this size the wall draws at normal size; bigger screens get proportionally bigger type, up to MAX_AUTO.
 * Whichever side runs out first sets the size, so an ultrawide grows by its height and gets the extra width as room.
 */
const BASE_WIDTH = 1600;
const BASE_HEIGHT = 900;
const MAX_AUTO = 3;
const round = (n: number) => Math.round(n * 10) / 10;

/** How much bigger than normal to draw the wall in a window this many CSS pixels wide and tall. */
export function autoScale(width: number, height: number): number {
  return round(Math.min(MAX_AUTO, Math.max(1, Math.min(width / BASE_WIDTH, height / BASE_HEIGHT))));
}

/** The viewer's own adjustment on top of autoScale, after pressing +, - or 0 (back to 1). */
export function nextScale(current: number, key: "+" | "-" | "0"): number {
  if (key === "0") return 1;
  return round(Math.max(0.5, current + (key === "+" ? 0.1 : -0.1)));
}
