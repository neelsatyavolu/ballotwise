import type { Db } from "../auth/accounts";
import { agrees, recordCalls, type Call } from "./calls";
import { CivicError, fetchCatalog, fetchOtherRace, fetchRace, FRESH_MS } from "./civic";
import { fetchCountyRace, isCountyRace } from "./county";
import { BASELINE_2024 } from "./data";
import { raceHistory, recordHistory } from "./history";
import { evidenceAt, raceKey, ratedRaces, readOdds, refreshOdds } from "./odds";
import { electionModeDefault } from "./polls";
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
  const catalog = await fetchCatalog(now, ratedRaces(odds), db, background, true);
  const { races, fetchedAt, coverage, partial } = catalog;
  // Both record only from a fresh catalog newer than the last one processed; a stale one just reads what's known.
  const [{ calls, events, counts }, trends] = await Promise.all([recordCalls(db, catalog, now), recordHistory(db, catalog, now)]);
  const withSignals = races.map((r) => ({ ...withCall(r, calls.get(r.id) ?? null), signal: odds?.signals[raceKey(r.office, r.state, r.district)] ?? null, trend: trends.get(r.id) ?? null }));
  return {
    races: withSignals,
    // Counted after calls are applied, so a race whose answer left out its winner still counts for the called side.
    balance: balance(withSignals),
    fetchedAt,
    stale: isStale(catalog, now),
    ...(partial && { partial }),
    coverage,
    ratings: { updatedAt: evidenceAt(odds) },
    callEvents: events,
    callEventCounts: counts,
  };
}

/**
 * Past this age, results shown while a refresh runs behind them count as stale. Above FRESH_MS plus the time a refresh
 * takes, so the usual serve-then-refresh cycle (a copy up to about 35 seconds old) doesn't flicker stale on each poll.
 */
export const STALE_AFTER_MS = FRESH_MS + 15_000;

/**
 * For viewers, results are stale when served from a fallback (civicAPI failed or was slow) or older than
 * STALE_AFTER_MS on election night, as a catalog served while it refreshes in the background can be. Before then
 * nothing is counting, so an older copy isn't slow. Recording still goes by the
 * catalog's own `stale`.
 */
export const isStale = (fetched: { stale: boolean; fetchedAt: number }, now: number) =>
  fetched.stale || (electionModeDefault(now) && now - fetched.fetchedAt > STALE_AFTER_MS);

/**
 * A race with its recorded call and `calledFor`, or with `callPending` when the call disagrees with the race's current
 * winner (or, for a missing race, its retained one): the recorded log can trail or lead the catalog being served.
 * A race whose answer left out who won (`callUnknown`) keeps its recorded call, winner flag included.
 */
export function withCall(race: RaceSummary, call: Call | null): RaceSummary {
  if (race.callUnknown && call && !call.withdrawn && race.candidates.some((c) => c.name === call.winner)) {
    return { ...race, candidates: race.candidates.map((c) => (c.name === call.winner ? { ...c, winner: true } : c)), call, calledFor: call.winner };
  }
  if (!agrees(call, race)) return { ...race, call: null, callPending: true, calledFor: null };
  return { ...race, call, calledFor: race.candidates.find((c) => c.winner)?.name ?? null };
}

/** One tracked race with county results and its rating signals, or null when the id isn't a tracked race. */
export async function race(db: Db, id: number, now: number, background?: (work: Promise<unknown>) => void) {
  const odds = await readOdds(db, now);
  const catalog = await fetchCatalog(now, ratedRaces(odds), db, background, true);
  const summary = catalog.races.find((r) => r.id === id);
  if (!summary) return null;
  const found = await fetchRace(summary, now, BASELINE_2024);
  // Calls come from the catalog's races, so this reuses the overview's memo and rarely touches the database.
  const [{ calls }, history] = await Promise.all([recordCalls(db, catalog, now), raceHistory(db, id)]);
  // The detail's results come from their own fetch, so a call the catalog hasn't caught up with is held back as pending.
  const shown = withCall(found.race, calls.get(id) ?? null);
  const callPending = !!shown.callPending;
  return { ...found, stale: isStale(found, now), race: { ...found.race, ...shown, signal: odds?.signals[raceKey(summary.office, summary.state, summary.district)] ?? null }, callPending, history };
}

/**
 * A race outside the tracked offices (a mayor, a school board seat, a local question), straight from civicAPI by id
 * or from a county's own results (Santa Clara's), shaped like race() for the race page: no ratings, calls feed, or
 * vote history. Null when there's no such US race.
 */
export async function otherRace(id: number, now: number) {
  const found = isCountyRace(id) ? await fetchCountyRace(id, now) : await fetchOtherRace(id, now, BASELINE_2024);
  return found && { ...found, race: { ...found.race, signal: null, call: null }, callPending: false as const };
}

/**
 * Records race calls and vote history from the current catalog, for the cron job, so recording doesn't wait on page
 * views. Returns the catalog's races for the push alerts that follow.
 */
export async function recordResults(db: Db, now: number): Promise<RaceSummary[]> {
  const catalog = await fetchCatalog(now, [], db);
  await Promise.all([recordCalls(db, catalog, now), recordHistory(db, catalog, now)]);
  return catalog.races;
}

export async function trackedIds(now: number, db?: Db): Promise<Set<number>> {
  return new Set((await fetchCatalog(now, [], db)).races.map((r) => r.id));
}

export { CivicError };
