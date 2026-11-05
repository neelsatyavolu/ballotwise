// Server only: each county's margin in recent past elections (see scripts/build-past-counties.mjs), for the race map's
// Swing view. Kept out of races.ts, which the browser loads, so the table stays on the server.
import past from "./pastCounties.json";
import type { CountyResult } from "./races";

const PAST: Readonly<Record<string, Readonly<Record<string, number>>>> = past;

/**
 * The race with each county's past margins attached. Alaska is left out: civicAPI's Alaska rows are boroughs or House
 * districts, and the past files code them differently.
 */
export function withPast<T extends { state: string; counties: CountyResult[] }>(race: T): T {
  if (race.state === "AK") return race;
  return {
    ...race,
    counties: race.counties.map((c) => {
      const fips = c.fips;
      if (!fips) return c;
      const margins = Object.entries(PAST).flatMap(([id, byFips]) => (byFips[fips] === undefined ? [] : [[id, byFips[fips]] as const]));
      return margins.length ? { ...c, past: Object.fromEntries(margins) } : c;
    }),
  };
}
