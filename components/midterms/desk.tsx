"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAccount } from "@/components/AccountProvider";
import { ApiError } from "@/lib/client";
import { createDeskStore, EMPTY_DESK, type DeskData } from "@/lib/ddhq/store";
import type { DdhqSeat } from "@/lib/ddhq/votes";

const store = createDeskStore(async <T,>(path: string, body: unknown | undefined, signal: AbortSignal): Promise<T> => {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof error?.error === "string" && error.error.trim() ? error.error : "Decision Desk HQ did not answer.";
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
});

type SeatSource = { office: string; state: string; district: number | null; title: string };

/** Each mounted consumer contributes seats; a detail panel cannot replace the whole catalog. */
export function useDeskSeats(races: readonly SeatSource[]) {
  const source = useRef(Symbol("desk-seats"));
  const seats = useMemo(() => races
    .filter((race) => race.office === "senate" || race.office === "house" || race.office === "governor")
    .map((race): DdhqSeat => ({ state: race.state, office: race.office as DdhqSeat["office"], district: race.district, special: /special/i.test(race.title) })), [races]);
  useEffect(() => {
    store.setSeats(source.current, seats);
  }, [seats]);
  useEffect(() => {
    const key = source.current;
    return () => store.removeSeats(key);
  }, []);
}

/** Only the active account can read its private snapshot, including before effects run. */
export function useDeskData(): DeskData {
  const { ddhq, user, refresh } = useAccount();
  const owner = ddhq === "connected" ? user?.id ?? null : null;
  const snapshot = useSyncExternalStore(store.subscribe, () => store.getForOwner(owner), () => EMPTY_DESK);
  useEffect(() => {
    if (owner) store.connect(owner, refresh);
    else store.disconnect();
  }, [owner, refresh]);
  return snapshot;
}

export function useDeskOverlay() {
  return useDeskData().races;
}
