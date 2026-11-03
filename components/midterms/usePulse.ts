"use client";

import { useSyncExternalStore } from "react";
import type { Pulse, PulseRace } from "@/lib/ddhq/pulse";
import { simAt } from "@/lib/midterms/clock";
import { raceKey } from "@/lib/midterms/seats";
import type { RaceSummary } from "@/lib/midterms/view";

const PATH = "/api/midterms/pulse";
/** The server reads DDHQ once a minute (PULSE_FRESH_MS), so asking more often gains nothing. */
const POLL_MS = 60_000;
/** A mock night's Pulse is worked out here from its made-up count, which moves faster. */
const MOCK_POLL_MS = 10_000;

/** One poll per tab, however many cards and panels ask: the latest answer, and who's listening. */
let latest: Pulse | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** DDHQ's Pulse from the server, or on a mock night (or preview) one made up to match its made-up count. */
async function read(): Promise<Pulse | null> {
  const at = simAt();
  if (at !== null) return (await import("@/lib/midterms/mockPulse")).mockPulse(at);
  const res = await fetch(PATH);
  return res.ok ? ((await res.json()) as Pulse) : null;
}

async function poll() {
  timer = null;
  if (!document.hidden) {
    try {
      const next = await read();
      if (next) {
        latest = next;
        listeners.forEach((l) => l());
      }
    } catch {
      // Offline or DDHQ down: keep the last answer and try again next time.
    }
  }
  if (listeners.size && !timer) timer = setTimeout(poll, simAt() === null ? POLL_MS : MOCK_POLL_MS);
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
 * DDHQ Pulse (lib/ddhq/pulse.ts), or null until it loads. A mock night or a preview shows a made-up one
 * (lib/midterms/mockPulse.ts), since DDHQ's real numbers would contradict its made-up results.
 */
export function usePulse(): Pulse | null {
  return useSyncExternalStore(subscribe, () => latest, () => null);
}

/** The race's Pulse, or null when DDHQ doesn't model it live or it's been called. */
export function racePulse(pulse: Pulse | null, race: Pick<RaceSummary, "office" | "state" | "district" | "candidates">): PulseRace | null {
  if (!pulse || race.candidates.some((c) => c.winner)) return null;
  return pulse.races[raceKey(race.office, race.state, race.district)] ?? null;
}
