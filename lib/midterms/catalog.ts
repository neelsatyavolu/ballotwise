import type { Db } from "../auth/accounts";
import { CivicError, fetchCatalog, fetchRace } from "./civic";
import { BASELINE_2024 } from "./data";
import { evidenceAt, raceKey, ratedRaces, readOdds, refreshOdds } from "./odds";
import { balance, type RaceSummary } from "./races";

export const UNAVAILABLE = "Live results are unavailable right now. They'll come back on their own; try again in a minute.";
/** Ratings older than this are refreshed in the background on the next page load (the cron job normally keeps them fresh). */
const ODDS_STALE_MS = 10 * 60 * 1000;

/** Every race with no ratings attached, for jobs that compute ratings. */
export async function bareRaces(now: number): Promise<RaceSummary[]> {
  return (await fetchCatalog(now, [])).races;
}

/**
 * The tracker's overview: every race with its market/poll rating, plus seat counts.
 * `background` runs a refresh after the response when ratings are stale. Throws CivicError when civicAPI is down and nothing is cached.
 */
export async function overview(db: Db, now: number, background: (work: Promise<unknown>) => void) {
  const odds = await readOdds(db, now);
  // Live results never wait on the markets: a missing or stale snapshot is rebuilt after the response.
  if (!odds || now - odds.at > ODDS_STALE_MS) {
    background(bareRaces(now).then((races) => refreshOdds(db, races, now)).catch((err) => console.error("midterms odds refresh failed:", err)));
  }
  const { races, fetchedAt, stale } = await fetchCatalog(now, ratedRaces(odds));
  const withSignals = races.map((r) => ({ ...r, signal: odds?.signals[raceKey(r.office, r.state, r.district)] ?? null }));
  return { races: withSignals, balance: balance(races), fetchedAt, stale, ratings: { updatedAt: evidenceAt(odds) } };
}

/** One tracked race with county results and its rating signals, or null when the id isn't a tracked race. */
export async function race(db: Db, id: number, now: number) {
  const odds = await readOdds(db, now);
  const { races } = await fetchCatalog(now, ratedRaces(odds));
  const summary = races.find((r) => r.id === id);
  if (!summary) return null;
  const found = await fetchRace(summary, now, BASELINE_2024);
  return { ...found, race: { ...found.race, signal: odds?.signals[raceKey(summary.office, summary.state, summary.district)] ?? null } };
}

export async function trackedIds(now: number): Promise<Set<number>> {
  return new Set((await fetchCatalog(now, [])).races.map((r) => r.id));
}

export { CivicError };
