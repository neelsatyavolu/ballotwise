"use client";
// DDHQ's full count for one race, county by county, on a screen with a connected Votes Pro account. The board's live
// counts come from DDHQ's batch topline, which has no counties, so a page showing one race's county map asks for it.

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { applyDesk, civicFresh } from "@/lib/ddhq/apply";
import type { DdhqRace } from "@/lib/ddhq/votes";
import type { RaceDetail } from "@/lib/midterms/races";
import { pollInterval } from "./hooks";
import { useDeskData } from "./desk";

/** How often the race is asked for again: as often as the board, and at least every 20 seconds. */
const MAX_WAIT_MS = 20_000;

/**
 * `race` with DDHQ's own count and counties laid over it, once they're in; the race as given until then, if DDHQ
 * fails, and on screens without a connected account. `from` is the public payload the race came in (its fetch time
 * and staleness), which says whether civicAPI's count may stand in where it's ahead.
 */
export function useDeskDetail(race: RaceDetail | null | undefined, from?: { stale?: boolean; fetchedAt?: number } | null): RaceDetail | null {
  const desk = useDeskData();
  const { refresh } = useAccount();
  const seat = race && desk.enabled && race.office !== "measure" && !race.local
    ? { office: race.office, state: race.state, district: race.district, special: /special/i.test(race.title) }
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
  const fresh = civicFresh(from);
  return useMemo(() => (race && own ? applyDesk(race, own, fresh) : race ?? null), [race, own, fresh]);
}
