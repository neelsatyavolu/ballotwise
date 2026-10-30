"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import { clockNow } from "@/lib/midterms/clock";
import type { Observation } from "@/lib/midterms/history";
import type { RaceDetail } from "@/lib/midterms/races";
import type { Overview } from "@/lib/midterms/view";
import { LIVE_TIMEOUT_MS } from "@/lib/midterms/live";
import { pollInterval, useLive } from "../hooks";

export type RaceData = { race: RaceDetail; fetchedAt: number; stale: boolean; history?: Observation[] };
type Data = {
  overview: Overview | null;
  forecast: ForecastOverview | null;
  error: string | null;
  races: ReadonlyMap<number, RaceData | "missing">;
};

const DataContext = createContext<Data>({ overview: null, forecast: null, error: null, races: new Map() });
export const useDashboardData = () => useContext(DataContext);

/** Requests in flight at once when a dashboard refreshes its races. */
const PARALLEL = 6;

/**
 * Everything a dashboard's panels read, fetched once for the whole board: the overview (every tracked race, the
 * balance and calls), the forecast, and each race a panel names, however many panels show it. Untracked races
 * (mayors, school boards) come through the same race route.
 */
export function DashboardData({ raceIds, children }: { raceIds: readonly number[]; children: ReactNode }) {
  const live = useLive<Overview>("/api/midterms");
  const forecast = useLive<ForecastOverview>("/api/midterms/forecast");
  const [races, setRaces] = useState<ReadonlyMap<number, RaceData | "missing">>(new Map());
  const key = useMemo(() => [...new Set(raceIds)].sort((a, b) => a - b).join(","), [raceIds]);

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",").map(Number);
    let live = true;
    async function load() {
      const found = new Map<number, RaceData | "missing">();
      for (let i = 0; i < ids.length; i += PARALLEL) {
        await Promise.all(
          ids.slice(i, i + PARALLEL).map(async (id) => {
            try {
              const res = await fetch(`/api/midterms/race/${id}`, { signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });
              if (res.ok) found.set(id, (await res.json()) as RaceData);
              else if (res.status === 404) found.set(id, "missing");
            } catch {
              // Keep the last good copy; the next refresh tries again.
            }
          }),
        );
      }
      if (live) setRaces((prev) => new Map([...prev, ...found]));
    }
    // Each refresh waits for the last to finish, and the wait is re-read so a board left open speeds up on election night.
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (document.visibilityState === "visible") await load();
      if (live) timer = setTimeout(tick, pollInterval(clockNow()));
    }
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  const value = useMemo(() => ({ overview: live.data, forecast: forecast.data, error: live.error, races }), [live.data, forecast.data, live.error, races]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
