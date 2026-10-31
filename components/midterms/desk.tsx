"use client";

import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useAccount } from "@/components/AccountProvider";
import { ApiError } from "@/lib/client";
import { createDeskStore, deskOwner, EMPTY_DESK, type DeskData } from "@/lib/ddhq/store";
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
const ServerOwner = createContext<string | null>(null);

function DeskKeeper() {
  useDeskData();
  return null;
}

/** The tracker layout keeps private data alive across its child-page navigations. */
export function DeskProvider({ owner, children }: { owner: string | null; children: ReactNode }) {
  const identity = deskOwner(owner, useAccount());
  return <ServerOwner.Provider value={owner}><DeskKeeper /><Fragment key={identity ?? "public"}>{children}</Fragment></ServerOwner.Provider>;
}

/** Each mounted consumer contributes seats; a detail panel cannot replace the whole catalog. */
export function useDeskSeats(races: readonly SeatSource[]) {
  const source = useRef(Symbol("desk-seats"));
  const seats = useMemo(() => races
    .filter((race) => race.office === "senate" || race.office === "house" || race.office === "governor")
    .map((race): DdhqSeat => ({ state: race.state, office: race.office as DdhqSeat["office"], district: race.district, special: /special/i.test(race.title) })), [races]);
  useLayoutEffect(() => {
    store.setSeats(source.current, seats);
  }, [seats]);
  useLayoutEffect(() => {
    const key = source.current;
    return () => store.removeSeats(key);
  }, []);
}

/** Only the active account can read its private snapshot, including before effects run. */
export function useDeskData(): DeskData & { enabled: boolean; owner: string | null } {
  const account = useAccount();
  const { refresh } = account;
  const serverOwner = useContext(ServerOwner);
  const owner = deskOwner(serverOwner, account);
  const snapshot = useSyncExternalStore(store.subscribe, () => store.getForOwner(owner), () => EMPTY_DESK);
  useEffect(() => {
    if (owner) store.connect(owner, refresh);
    else store.disconnect();
  }, [owner, refresh]);
  return useMemo(() => ({ ...snapshot, enabled: owner !== null, owner }), [snapshot, owner]);
}

export function useDeskOverlay() {
  return useDeskData().races;
}
