"use client";

import { useSyncExternalStore } from "react";
import type { Pulse, PulseRace } from "@/lib/ddhq/pulse";
import { simAt } from "@/lib/midterms/clock";
import { raceKey } from "@/lib/midterms/seats";
import type { RaceSummary } from "@/lib/midterms/view";

const PATH = "/api/midterms/pulse";
/** The server reads DDHQ once a minute (PULSE_FRESH_MS), so asking more often gains nothing. */
const POLL_MS = 60_000;

/** One poll per tab, however many cards and panels ask: the latest answer, and who's listening. */
let latest: Pulse | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function poll() {
  timer = null;
  if (!document.hidden) {
    try {
      const res = await fetch(PATH);
      if (res.ok) {
        latest = (await res.json()) as Pulse;
        listeners.forEach((l) => l());
      }
    } catch {
      // Offline or DDHQ down: keep the last answer and try again next time.
    }
  }
  if (listeners.size && !timer) timer = setTimeout(poll, POLL_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && !timer) void poll();
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * DDHQ Pulse (lib/ddhq/pulse.ts), or null until it loads. A mock night or a preview has made-up results, so it shows
 * no Pulse: DDHQ's real numbers would contradict them.
 */
export function usePulse(): Pulse | null {
  const pulse = useSyncExternalStore(subscribe, () => latest, () => null);
  return simAt() === null ? pulse : null;
}

/** The race's Pulse, or null when DDHQ doesn't model it live or it's been called. */
export function racePulse(pulse: Pulse | null, race: Pick<RaceSummary, "office" | "state" | "district" | "candidates">): PulseRace | null {
  if (!pulse || race.candidates.some((c) => c.winner)) return null;
  return pulse.races[raceKey(race.office, race.state, race.district)] ?? null;
}
