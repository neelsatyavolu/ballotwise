import { CivicError, fetchCatalog, fetchRace } from "./civic";
import { BASELINE_2024, RATINGS, RATINGS_AS_OF, RATING_SOURCES } from "./data";
import { balance } from "./races";

export const UNAVAILABLE = "Live results are unavailable right now. They'll come back on their own; try again in a minute.";

/** The tracker's overview: every race plus seat counts. Throws CivicError when civicAPI is down and nothing is cached. */
export async function overview(now: number) {
  const { races, fetchedAt, stale } = await fetchCatalog(now, RATINGS);
  return { races, balance: balance(races), fetchedAt, stale, ratings: { asOf: RATINGS_AS_OF, sources: RATING_SOURCES } };
}

/** One tracked race with county results, or null when the id isn't a tracked race. */
export async function race(id: number, now: number) {
  const { races } = await fetchCatalog(now, RATINGS);
  const summary = races.find((r) => r.id === id);
  return summary ? fetchRace(summary, now, BASELINE_2024) : null;
}

export async function trackedIds(now: number): Promise<Set<number>> {
  return new Set((await fetchCatalog(now, RATINGS)).races.map((r) => r.id));
}

export { CivicError };
