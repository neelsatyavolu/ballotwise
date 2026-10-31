import type { Db } from "@/lib/auth/accounts";
import { getCached } from "@/lib/cache";
import { HISTORY_KEY, POLLS_KEY, raceKey, type ForecastHistory } from "@/lib/midterms/odds";
import type { RacePolls } from "@/lib/midterms/pollAverage";
import type { RaceSummary } from "@/lib/midterms/races";

export type RaceInsights = {
  /** The forecast's daily chance for `side` (the side facing the Republican), one value per entry in `days`. */
  history: { days: string[]; side: "D" | "R" | "I"; p: (number | null)[] } | null;
  polls: RacePolls | null;
};

/** One race's forecast history and polls, for the race page's Forecast and Polls panels. */
export async function raceInsights(db: Db, race: Pick<RaceSummary, "office" | "state" | "district">, now: number): Promise<RaceInsights> {
  const key = raceKey(race.office, race.state, race.district);
  const [history, polls] = await Promise.all([getCached<ForecastHistory>(db, HISTORY_KEY, now), getCached<Record<string, RacePolls>>(db, POLLS_KEY, now)]);
  const line = history?.races[key];
  return { history: line && history ? { days: history.days, side: line.side, p: line.p } : null, polls: polls?.[key] ?? null };
}
