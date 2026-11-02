"use client";

import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useAccount } from "@/components/AccountProvider";
import { ApiError } from "@/lib/client";
import { simAt } from "@/lib/midterms/clock";
import { createDeskStore, deskOwner, EMPTY_DESK, type DeskData, type DeskStorage } from "@/lib/ddhq/store";
import type { DdhqSeat } from "@/lib/ddhq/votes";

/** This tab's session storage, or nothing on the server or where the browser blocks it. */
function tabStorage(): DeskStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

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
}, tabStorage());

type SeatSource = { office: string; state: string; district: number | null; title: string };
const ServerOwner = createContext<string | null>(null);

/** Screens waiting on a DDHQ request of their own (a race's detail), so the loading note stays up until it's back. */
const waiters = new Set<symbol>();
const waiterListeners = new Set<() => void>();
const subscribeWaiters = (listener: () => void) => {
  waiterListeners.add(listener);
  return () => void waiterListeners.delete(listener);
};
const anyWaiting = () => waiters.size > 0;
const notifyWaiters = () => {
  for (const listener of waiterListeners) listener();
};

/** Keeps the loading note up while `waiting`. */
export function useDeskWaiting(waiting: boolean) {
  const id = useRef(Symbol("desk-waiting"));
  useEffect(() => {
    if (!waiting) return;
    const key = id.current;
    waiters.add(key);
    notifyWaiters();
    return () => {
      waiters.delete(key);
      notifyWaiters();
    };
  }, [waiting]);
}

/** Keeps the private data alive, and says so while DDHQ's numbers are still on their way and the public ones show. */
function DeskKeeper() {
  const desk = useDeskData();
  const waiting = useSyncExternalStore(subscribeWaiters, anyWaiting, () => false);
  const loading = desk.enabled && (waiting || desk.countsPending || (desk.forecastStatus === "loading" && !desk.forecast));
  return loading ? <p className="mt-desk-loading" role="status">Loading Decision Desk HQ…</p> : null;
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

const noSubscribe = () => () => {};
const rehearsing = () => simAt() !== null;

/**
 * Only the active account can read its private snapshot, including before effects run. A mock night or `?sim=`
 * preview turns DDHQ off: its real counts (none before Nov 3) would cover the made-up ones. The server never runs
 * one, so the first render matches the server's and the switch happens right after.
 */
export function useDeskData(): DeskData & { enabled: boolean; owner: string | null } {
  const account = useAccount();
  const { refresh } = account;
  const serverOwner = useContext(ServerOwner);
  const rehearsal = useSyncExternalStore(noSubscribe, rehearsing, () => false);
  const owner = rehearsal ? null : deskOwner(serverOwner, account);
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
