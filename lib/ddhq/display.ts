import { balance, type Office, type RaceSummary } from "../midterms/races";
import type { Overview } from "../midterms/view";
import { deskKeyFor, isDesk, overlayLive } from "./apply";
import type { ResultsSource } from "./source";
import type { DeskData } from "./store";

export type DeskDisplayOptions = { office?: Office; forecastOnly?: boolean };

/** The public catalog is used for identity/geometry, never to flash unverified private results. */
export function deskRaces(path: string | null, raw: unknown, office?: Office): RaceSummary[] {
  if (!raw || typeof raw !== "object") return [];
  const rows = path === "/api/midterms" && "races" in raw ? (raw as Overview).races
    : path && /^\/api\/midterms\/race\/\d+$/.test(path) && "race" in raw ? [(raw as { race: RaceSummary }).race] : [];
  return rows.filter((race) => race.office !== "measure" && !race.local && (!office || race.office === office));
}

/** Forecast-only screens have no reason to consult public vote leaders while DDHQ counts are pending. */
function forecastCatalog<T>(path: string | null, raw: T, desk: DeskData): T {
  if (!raw || typeof raw !== "object") return raw;
  const mask = <R extends RaceSummary>(race: R): R => {
    const key = deskKeyFor(race);
    if (race.office === "measure" || race.local || desk.countsReady.has(key) || desk.countsFailed.has(key)) return race;
    return {
      ...race, total: 0, reporting: 0, reportingUnknown: true, calledFor: null, call: null, callPending: undefined,
      candidates: race.candidates.map((candidate) => ({ ...candidate, votes: 0, pct: 0, winner: false })),
    };
  };
  if (path === "/api/midterms" && "races" in raw) {
    const body = raw as unknown as Overview;
    const races = body.races.map(mask);
    const pending = new Set(body.races.filter((race, i) => race !== races[i]).map((race) => race.id));
    return { ...body, races, balance: balance(races), callEvents: body.callEvents?.filter((event) => !pending.has(event.raceId)), callEventCounts: undefined } as T;
  }
  if (path && /^\/api\/midterms\/race\/\d+$/.test(path) && "race" in raw) {
    return { ...raw, race: mask((raw as { race: RaceSummary }).race) };
  }
  return raw;
}

/**
 * The page as the connected viewer sees it. Nothing waits on DDHQ (chosen Nov 2): until its counts and forecast are
 * back, the page shows the public data with whatever private data is already in hand (this tab's saved snapshot, or
 * races already counted), and DeskStatus says DDHQ is loading. DDHQ's numbers replace the public ones as they arrive.
 */
export function selectDeskDisplay<T>(path: string | null, raw: T | null, desk: DeskData & { enabled: boolean; source?: ResultsSource }, options: DeskDisplayOptions = {}): { data: T | null; loading: boolean; error: string | null; privateSource: boolean } {
  const rows = deskRaces(path, raw, options.office);
  const eligible = path === "/api/midterms/forecast" || path === "/api/midterms" && options.office !== "measure" || rows.length > 0;
  if (!desk.enabled || !eligible) return { data: raw, loading: false, error: null, privateSource: false };
  const waitingCounts = !options.forecastOnly && rows.some((race) => {
    const key = deskKeyFor(race);
    return !desk.countsReady.has(key) && !desk.countsFailed.has(key);
  });
  const failedCounts = !options.forecastOnly && rows.some((race) => desk.countsFailed.has(deskKeyFor(race)));
  const base = options.forecastOnly && desk.forecast ? forecastCatalog(path, raw, desk) : raw;
  let data = overlayLive(path, base, desk.races, desk.forecast, desk.source);
  // Public vote-drop history must not be charted alongside this user's current DDHQ count.
  if (path && /^\/api\/midterms\/race\/\d+$/.test(path) && data && typeof data === "object" && "race" in data && isDesk((data as { race: RaceSummary }).race)) {
    data = { ...data, history: [] };
  }
  if (!options.forecastOnly && !failedCounts && !waitingCounts && rows.length && desk.countsFetchedAt && data && typeof data === "object") {
    data = { ...data, fetchedAt: desk.countsFetchedAt, stale: false };
  }
  return { data, loading: false, error: failedCounts ? desk.countsError ?? "DDHQ results are unavailable. Showing the public fallback." : null, privateSource: !!desk.forecast || rows.some((race) => desk.countsReady.has(deskKeyFor(race))) };
}
