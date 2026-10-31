"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAccount } from "@/components/AccountProvider";
import { api, ApiError } from "@/lib/client";
import type { DdhqRace, DdhqSeat } from "@/lib/ddhq/votes";

type Seat = DdhqSeat;
type Listener = () => void;

const listeners = new Set<Listener>();
let map: ReadonlyMap<string, DdhqRace> = new Map();
let seats: Seat[] = [];
let runningFor: string | null = null;
let stop = false;

function publish(next: ReadonlyMap<string, DdhqRace>) {
  map = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function noteSeats(races: { office: string; state: string; district: number | null; title: string }[]) {
  seats = races
    .filter((race) => race.office === "senate" || race.office === "house" || race.office === "governor")
    .map((race) => ({
      state: race.state,
      office: race.office as Seat["office"],
      district: race.district,
      special: /special/i.test(race.title),
    }));
}

function shutdown() {
  stop = true;
  runningFor = null;
  if (map.size) publish(new Map());
}

async function pass(refresh: () => Promise<void>) {
  const todo = seats;
  if (!todo.length) return;
  const next = new Map(map);
  for (let i = 0; i < todo.length; i += 24) {
    if (stop) return;
    try {
      const body = await api<{ races: { key: string; race: DdhqRace | null }[] }>("/api/ddhq/races", { body: { seats: todo.slice(i, i + 24) } });
      for (const row of body.races) if (row.race) next.set(row.key, row.race);
      publish(new Map(next));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        shutdown();
        await refresh();
        return;
      }
      return;
    }
  }
}

function ensure(userId: string, refresh: () => Promise<void>) {
  if (runningFor === userId) return;
  shutdown();
  stop = false;
  runningFor = userId;
  void (async () => {
    while (!stop && runningFor === userId) {
      const waiting = seats.length === 0;
      await pass(refresh);
      await new Promise((resolve) => setTimeout(resolve, waiting ? 2000 : 60_000));
    }
  })();
}

const empty: ReadonlyMap<string, DdhqRace> = new Map();

/** Decision Desk HQ counts for the signed-in user, empty when the switch is off. */
export function useDeskOverlay(): ReadonlyMap<string, DdhqRace> {
  const { ddhq, user, refresh } = useAccount();
  const id = user?.id ?? null;
  const current = useSyncExternalStore(subscribe, () => map, () => empty);
  useEffect(() => {
    if (ddhq !== "connected" || !id) {
      shutdown();
      return;
    }
    ensure(id, refresh);
  }, [ddhq, id, refresh]);
  return ddhq === "connected" ? current : empty;
}
