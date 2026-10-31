import type { DdhqForecastBundle } from "./forecast-types";
import type { DdhqRace, DdhqSeat } from "./votes";

export type DeskData = {
  races: ReadonlyMap<string, DdhqRace>;
  forecast: DdhqForecastBundle["overview"] | null;
  forecastStatus: "idle" | "loading" | "ready" | "error";
  forecastError: string | null;
};
type Snapshot = DeskData & { owner: string | null };
type Request = <T>(path: string, body: unknown | undefined, signal: AbortSignal) => Promise<T>;
type Run = { owner: string; controller: AbortController; expired: () => Promise<void> };
type Counts = { races: { key: string; race: DdhqRace | null }[] };

export const EMPTY_DESK: Snapshot = { owner: null, races: new Map(), forecast: null, forecastStatus: "idle", forecastError: null };
const REFRESH_MS = 60_000;
const keyOf = (seat: DdhqSeat) => `${seat.office}:${seat.state}:${seat.office === "house" ? (seat.district ?? 0) : ""}:${seat.special ? "s" : "g"}`;

/** Tab-local private data. Run identity guards even requests whose transport ignores abort. */
export function createDeskStore(request: Request) {
  const listeners = new Set<() => void>();
  const sources = new Map<symbol, readonly DdhqSeat[]>();
  let seats = new Map<string, DdhqSeat>();
  let pending = new Set<string>();
  let forecasts = new Map<string, DdhqRace>();
  let counts = new Map<string, DdhqRace>();
  let overview: DeskData["forecast"] = null;
  let forecastStatus: DeskData["forecastStatus"] = "idle";
  let forecastError: string | null = null;
  let snapshot = EMPTY_DESK;
  let run: Run | null = null;
  let ready = false;
  let counting = false;
  let forecastTimer: ReturnType<typeof setTimeout> | undefined;
  let countTimer: ReturnType<typeof setTimeout> | undefined;

  const active = (mine: Run) => run === mine && !mine.controller.signal.aborted;
  const emit = () => { for (const listener of listeners) listener(); };

  function publish() {
    const races = new Map(counts);
    for (const [key, race] of forecasts) {
      const count = counts.get(key);
      races.set(key, {
        call: count?.call ?? null, candidates: count?.candidates ?? null, counties: count?.counties ?? [], total: count?.total ?? 0,
        forecast: race.forecast, rating: race.rating, updatedAt: race.updatedAt,
      });
    }
    snapshot = { owner: run?.owner ?? null, races, forecast: overview, forecastStatus, forecastError };
    emit();
  }

  function disconnect() {
    run?.controller.abort();
    run = null;
    clearTimeout(forecastTimer);
    clearTimeout(countTimer);
    forecastTimer = countTimer = undefined;
    ready = counting = false;
    pending = new Set();
    forecasts = new Map();
    counts = new Map();
    overview = null;
    forecastStatus = "idle";
    forecastError = null;
    snapshot = EMPTY_DESK;
    emit();
  }

  function expired(error: unknown, mine: Run): boolean {
    if (!active(mine)) return true;
    if (error && typeof error === "object" && "status" in error && error.status === 401) {
      disconnect();
      void mine.expired().catch(() => {});
      return true;
    }
    return false;
  }

  function scheduleCounts(mine: Run) {
    if (!active(mine) || countTimer || !seats.size) return;
    countTimer = setTimeout(() => {
      countTimer = undefined;
      if (!active(mine)) return;
      for (const key of seats.keys()) pending.add(key);
      void drain(mine);
    }, REFRESH_MS);
  }

  async function drain(mine: Run) {
    if (!active(mine) || !ready || counting) return;
    counting = true;
    try {
      while (active(mine) && pending.size) {
        const keys = [...pending].filter((key) => seats.has(key)).slice(0, 24);
        if (!keys.length) { pending.clear(); break; }
        for (const key of keys) pending.delete(key);
        let body: Counts | null = null;
        try {
          body = await request<Counts>("/api/ddhq/races", { seats: keys.map((key) => seats.get(key)!) }, mine.controller.signal);
        } catch (error) {
          if (expired(error, mine)) return;
        }
        if (!active(mine)) return;
        const found = new Map(body?.races.map((row) => [row.key, row.race]) ?? []);
        for (const key of keys) {
          counts.delete(key);
          const race = found.get(key);
          if (seats.has(key) && race && (race.candidates !== null || race.call !== null)) {
            // Counts never carry a second forecast that could outlive a failed forecast refresh.
            counts.set(key, { forecast: [], call: race.call, candidates: race.candidates, counties: race.counties, total: race.total });
          }
        }
        publish();
      }
    } finally {
      if (active(mine)) { counting = false; scheduleCounts(mine); }
    }
  }

  async function loadForecast(mine: Run) {
    if (!active(mine)) return;
    forecastStatus = "loading";
    // Keep the last safe error during a retry, until a successful response replaces it.
    publish();
    try {
      const body = await request<DdhqForecastBundle>("/api/ddhq/forecast", undefined, mine.controller.signal);
      if (!active(mine)) return;
      forecasts = new Map(body.races.map((row) => [row.key, row.race]));
      overview = body.overview;
      forecastStatus = "ready";
      forecastError = null;
      publish();
    } catch (error) {
      if (expired(error, mine)) return;
      forecasts = new Map();
      overview = null;
      forecastStatus = "error";
      forecastError = error instanceof Error && "status" in error && typeof error.status === "number"
        ? error.message
        : "Decision Desk HQ's published forecast is unavailable.";
      publish();
    } finally {
      if (active(mine)) {
        ready = true;
        void drain(mine);
        forecastTimer = setTimeout(() => void loadForecast(mine), REFRESH_MS);
      }
    }
  }

  function updateSeats() {
    const next = new Map<string, DdhqSeat>();
    for (const rows of sources.values()) for (const seat of rows) next.set(keyOf(seat), seat);
    for (const key of next.keys()) if (!seats.has(key)) pending.add(key);
    for (const key of seats.keys()) if (!next.has(key)) { pending.delete(key); counts.delete(key); }
    const removed = [...seats.keys()].some((key) => !next.has(key));
    seats = next;
    if (run && removed) publish();
    if (run) void drain(run);
  }

  return {
    getSnapshot: () => snapshot,
    getForOwner: (owner: string | null): DeskData => owner && snapshot.owner === owner ? snapshot : EMPTY_DESK,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); if (!listeners.size) disconnect(); };
    },
    connect(owner: string, onExpired: () => Promise<void>) {
      if (run?.owner === owner) return;
      disconnect();
      run = { owner, controller: new AbortController(), expired: onExpired };
      pending = new Set(seats.keys());
      publish();
      void loadForecast(run);
    },
    disconnect,
    setSeats(source: symbol, rows: readonly DdhqSeat[]) { sources.set(source, rows); updateSeats(); },
    removeSeats(source: symbol) { sources.delete(source); updateSeats(); },
  };
}
