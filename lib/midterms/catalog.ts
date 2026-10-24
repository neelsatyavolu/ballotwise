import type { Db } from "../auth/accounts";
import { agrees, recordCalls, type Call } from "./calls";
import { CivicError, fetchCatalog, fetchRace } from "./civic";
import { BASELINE_2024 } from "./data";
import { raceHistory, recordHistory } from "./history";
import { evidenceAt, raceKey, ratedRaces, readOdds, refreshOdds } from "./odds";
import { balance, type RaceSummary } from "./races";

export const UNAVAILABLE = "Live results are unavailable right now. They'll come back on their own; try again in a minute.";
/** Ratings older than this are refreshed in the background on the next page load (the cron job normally keeps them fresh). */
const ODDS_STALE_MS = 10 * 60 * 1000;

/** Every race with no ratings attached, for jobs that compute ratings. */
export async function bareRaces(now: number, db?: Db): Promise<RaceSummary[]> {
  return (await fetchCatalog(now, [], db)).races;
}

/**
 * The tracker's overview: every race with its market/poll rating, plus seat counts.
 * `background` runs a refresh after the response when ratings are stale. Throws CivicError when civicAPI is down and nothing is cached.
 */
export async function overview(db: Db, now: number, background: (work: Promise<unknown>) => void) {
  const odds = await readOdds(db, now);
  // Live results never wait on the markets: a missing or stale snapshot is rebuilt after the response.
  if (!odds || now - odds.at > ODDS_STALE_MS) {
    background(bareRaces(now, db).then((races) => refreshOdds(db, races, now)).catch((err) => console.error("midterms odds refresh failed:", err)));
  }
  const catalog = await fetchCatalog(now, ratedRaces(odds), db, background);
  const { races, fetchedAt, stale, coverage } = catalog;
  // Both record only from a fresh catalog newer than the last one processed; a stale one just reads what's known.
  const [{ calls, events, counts }, trends] = await Promise.all([recordCalls(db, catalog, now), recordHistory(db, catalog, now)]);
  const withSignals = races.map((r) => ({ ...withCall(r, calls.get(r.id) ?? null), signal: odds?.signals[raceKey(r.office, r.state, r.district)] ?? null, trend: trends.get(r.id) ?? null }));
  return { races: withSignals, balance: balance(races), fetchedAt, stale, coverage, ratings: { updatedAt: evidenceAt(odds) }, callEvents: events, callEventCounts: counts };
}

/**
 * A race with its recorded call, or with `callPending` when the call disagrees with the race's current winner (or,
 * for a missing race, its retained one): the recorded log can trail or lead the catalog being served.
 */
export function withCall(race: RaceSummary, call: Call | null): RaceSummary {
  return agrees(call, race) ? { ...race, call } : { ...race, call: null, callPending: true };
}

/** One tracked race with county results and its rating signals, or null when the id isn't a tracked race. */
export async function race(db: Db, id: number, now: number) {
  const odds = await readOdds(db, now);
  const catalog = await fetchCatalog(now, ratedRaces(odds), db);
  const summary = catalog.races.find((r) => r.id === id);
  if (!summary) return null;
  const found = await fetchRace(summary, now, BASELINE_2024);
  // Calls come from the catalog's races, so this reuses the overview's memo and rarely touches the database.
  const [{ calls }, history] = await Promise.all([recordCalls(db, catalog, now), raceHistory(db, id)]);
  // The detail's results come from their own fetch, so a call the catalog hasn't caught up with is held back as pending.
  const call = calls.get(id) ?? null;
  const callPending = !agrees(call, found.race);
  return { ...found, race: { ...found.race, signal: odds?.signals[raceKey(summary.office, summary.state, summary.district)] ?? null, call: callPending ? null : call }, callPending, history };
}

/** Records race calls and vote history from the current catalog, for the cron job, so recording doesn't wait on page views. */
export async function recordResults(db: Db, now: number): Promise<void> {
  const catalog = await fetchCatalog(now, [], db);
  await Promise.all([recordCalls(db, catalog, now), recordHistory(db, catalog, now)]);
}

export async function trackedIds(now: number, db?: Db): Promise<Set<number>> {
  return new Set((await fetchCatalog(now, [], db)).races.map((r) => r.id));
}

export { CivicError };
