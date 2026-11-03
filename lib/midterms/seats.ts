// The race-level inputs to the chamber simulations (forecast.ts chamberViews), kept free of the odds pipeline's
// sources so a browser can run the simulation too (the companion's live projection, liveProjection.ts).
import { leanBucket, PARAMS, type Forecast, type Side } from "./forecast";
import divisions from "./divisions.json";
import lean2026 from "./lean2026.json";
import type { Office, RaceSummary } from "./races";

const LEAN = lean2026 as { house: Record<string, number>; state: Record<string, number>; incumbents: Record<string, string> };

export const raceKey = (office: Office, state: string, district: number | null | undefined) => `${office}:${state}:${office === "house" ? (district ?? 0) : ""}`;

export const sideOf = (party: string): Side | null => (/^democrat/i.test(party) ? "D" : /^republican/i.test(party) ? "R" : /independent/i.test(party) ? "I" : null);

/** The seat's 2024 presidential margin: the district's for House races, the state's otherwise. */
export const leanOf = (r: Pick<RaceSummary, "office" | "state" | "district">): number | null =>
  (r.office === "house" ? LEAN.house[raceKey("house", r.state, r.district)] : LEAN.state[r.state]) ?? null;

/** Every race's forecast for the chamber simulations; a race between two candidates of one party goes to that party. */
export function chamberEntries(races: readonly RaceSummary[], forecastOf: (r: RaceSummary) => Pick<Forecast, "odds"> | null) {
  return races.flatMap((r) => {
    if (r.office === "measure") return [];
    const sides = new Set(r.candidates.map((c) => sideOf(c.party)).filter((s) => s === "D" || s === "R"));
    const odds = forecastOf(r)?.odds ?? (sides.size === 1 ? { [[...sides][0]!]: 1 } : null);
    const lean = leanOf(r);
    // The census division and lean bucket whose shared errors the race takes part in.
    const group = lean === null ? {} : { region: (divisions as Record<string, string>)[r.state], bucket: leanBucket(lean - PARAMS.national2024) };
    return odds ? [{ office: r.office, forecast: { odds }, ...group }] : [];
  });
}
