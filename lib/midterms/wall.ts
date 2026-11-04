// A wall screen: one office's results for a TV or spare monitor across the room. It sizes its type to the screen and
// its map tours the closest races on its own. Kept free of the browser so the rules can be tested on their own.
import { isCalled, isCompetitive, isWatch, watchFirst } from "./explore";
import { lead, type Office, type RaceSummary } from "./view";

/** A Senate race within this many points is toured whatever its rating. */
const CLOSE_LEAD = 10;
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
 * The races the map zooms into, only ones with votes to show: this office's uncalled toss-ups and leans (for the
 * Senate, its likely races and any within CLOSE_LEAD points too) that are
 * counting, then (the House only) its other uncalled races that are counting, each in watchFirst order (toss-ups that
 * look set to flip first, then closest). Once every one of those is called, the closest of the office's races with
 * votes counted (the Senate's toss-ups and leans only). Before any votes, none: the map stays on the whole country.
 */
export function tourRaces(races: readonly RaceSummary[], office: Office): RaceSummary[] {
  const mine = races.filter((r) => r.office === office);
  const open = (r: RaceSummary) => isWatch(r) || isCompetitive(r);
  const counting = mine.filter((r) => r.total > 0 && !isCalled(r));
  // The Senate's few seats: its toss-ups, leans and likely races, and any other within CLOSE_LEAD points (Mississippi,
  // unrated, was within 3 on Nov 3), never a lopsided one.
  const focused = office === "senate";
  const contested = (r: RaceSummary) => r.rating === "tossup" || !!r.rating?.startsWith("lean");
  const watched = (r: RaceSummary) => open(r) || !!r.rating?.startsWith("likely") || (lead(r.candidates)?.margin ?? Infinity) < CLOSE_LEAD;
  const tour = focused ? counting.filter(watched).sort(watchFirst) : [...counting.filter(open).sort(watchFirst), ...counting.filter((r) => !open(r)).sort(watchFirst)];
  const done = mine.filter((r) => r.total > 0 && (!focused || contested(r)));
  return (tour.length ? tour : done.sort(watchFirst)).slice(0, MAX_TOUR);
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
