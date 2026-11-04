"use client";
// DDHQ's full count for one race, county by county, on a screen with a connected Votes Pro account. The board's live
// counts come from DDHQ's batch topline, which has no counties, so a page showing one race's county map asks for it.

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { applyDesk, civicSeen } from "@/lib/ddhq/apply";
import type { DdhqRace } from "@/lib/ddhq/votes";
import type { RaceDetail, RaceSummary } from "@/lib/midterms/races";
import { pollInterval } from "./hooks";
import { useDeskData } from "./desk";

/** How often the race is asked for again: as often as the board, and at least every 20 seconds. */
const MAX_WAIT_MS = 20_000;

/**
 * `race` with DDHQ's own count and counties laid over it, once they're in; the race as given until then, if DDHQ
 * fails, and on screens without a connected account. `from` is the public payload the race came in (its fetch time),
 * which says whether civicAPI's count is recent enough to stand in where it's ahead. `summary` is the overview's copy
 * of the race: DDHQ is asked at once, without waiting on the public race (which waits on civicAPI, slow on election
 * night), and its counties go on that copy until the public race arrives.
 */
export function useDeskDetail(race: RaceDetail | null | undefined, from?: { stale?: boolean; fetchedAt?: number } | null, summary?: RaceSummary | null): RaceDetail | null {
  const desk = useDeskData();
  const { refresh } = useAccount();
  const which = race ?? summary;
  const seat = which && desk.enabled && which.office !== "measure" && !which.local
    ? { office: which.office, state: which.state, district: which.district, special: /special/i.test(which.title) }
    : null;
  const key = seat ? `${seat.office}:${seat.state}:${seat.district ?? ""}:${seat.special ? "s" : "g"}:${desk.owner ?? ""}` : "";
  const [reply, setReply] = useState<{ key: string; race: DdhqRace } | null>(null);

  useEffect(() => {
    if (!key || !seat) return;
    const params = new URLSearchParams({ state: seat.state, office: seat.office });
    if (seat.district != null) params.set("district", String(seat.district));
    if (seat.special) params.set("special", "1");
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    async function load() {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/ddhq/race?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
        if (response.status === 401) void refresh();
        const next = (await response.json()) as DdhqRace;
        // A failed or empty answer leaves the last good one (or the board's count) showing.
        if (live && response.ok && Array.isArray(next.candidates)) setReply({ key, race: next });
      } catch {
        // Offline or timed out: try again on the next round.
      } finally {
        if (live) timer = setTimeout(() => void load(), Math.min(MAX_WAIT_MS, pollInterval(Date.now())));
      }
    }
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
      controller?.abort();
    };
    // `seat` is derived from `key`, which names every field it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);

  const own = reply?.key === key ? reply.race : null;
  const seen = civicSeen(from);
  return useMemo(() => {
    const base = race ?? (own && summary ? { ...summary, pollsClose: null, updated: null, counties: [] } : null);
    return base && own ? applyDesk(base, own, race ? seen : null) : base;
  }, [race, own, seen, summary]);
}
