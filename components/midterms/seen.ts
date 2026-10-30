"use client";
// What this browser remembers between visits on election night: the calls already seen, each race's leader when the
// viewer last looked, a frozen row order and whether call alerts are on. Everything lives in localStorage and works,
// just without memory, when storage is off.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { clockNow } from "@/lib/midterms/clock";
import { isEarly } from "@/lib/midterms/explore";
import { outcomeOf } from "@/lib/midterms/holders";
import { lead, type RaceSummary } from "@/lib/midterms/view";

const CHANGED = "mt-seen";

/** A simulated night (`?sim=`) keeps its own memory, so a rehearsal never shows up on the real night. */
function scoped(key: string): string {
  try {
    return new URLSearchParams(window.location.search).has("sim") ? `${key}:sim` : key;
  } catch {
    return key;
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(scoped(key));
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(scoped(key));
    else localStorage.setItem(scoped(key), value);
  } catch {
    // Private windows can refuse storage; the value then lasts only for this page.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** One stored string, kept in step across components and tabs. Null when unset or on the server. */
export function useStored(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key), () => null);
  const set = useCallback((next: string | null) => writeStored(key, next), [key]);
  return [value, set];
}

function parse<T>(raw: string | null, ok: (x: unknown) => x is T): T | null {
  if (!raw) return null;
  try {
    const x: unknown = JSON.parse(raw);
    return ok(x) ? x : null;
  } catch {
    return null;
  }
}

/** A list of race ids from storage (a frozen order), or null. */
export function parseIds(raw: string | null): number[] | null {
  return parse(raw, (x): x is number[] => Array.isArray(x) && x.every((n) => Number.isInteger(n)));
}

/** What the viewer saw last: when, and who led each uncalled race with votes in. */
export type Snapshot = { at: number; leaders: Record<string, string> };

const isSnapshot = (x: unknown): x is Snapshot =>
  !!x && typeof x === "object" && typeof (x as Snapshot).at === "number" && !!(x as Snapshot).leaders && typeof (x as Snapshot).leaders === "object";

export function snapshotOf(races: readonly RaceSummary[], at = clockNow()): Snapshot {
  const leaders: Record<string, string> = {};
  for (const r of races) {
    const ahead = lead(r.candidates);
    if (ahead && ahead.margin > 0 && !r.candidates.some((c) => c.winner)) leaders[r.id] = ahead.leader.name;
  }
  return { at, leaders };
}

export type SinceCounts = { at: number; calls: number; flips: number; leadChanges: number; withdrawn: number; changed: ReadonlySet<number> };

/**
 * What happened since the snapshot: calls seen after it (and how many changed a seat's party), withdrawn calls, and
 * uncalled races where someone else now leads. An early count (under 25% reporting) changing hands isn't news.
 */
export function sinceSnapshot(snap: Snapshot, races: readonly RaceSummary[]): SinceCounts {
  let calls = 0;
  let flips = 0;
  let withdrawn = 0;
  const changed = new Set<number>();
  for (const r of races) {
    const call = r.call && r.call.at > snap.at ? r.call : null;
    if (call?.withdrawn) withdrawn += 1;
    else if (call && r.candidates.some((c) => c.winner)) {
      calls += 1;
      if (outcomeOf(r)?.gain) flips += 1;
      continue;
    }
    const before = snap.leaders[r.id];
    const ahead = lead(r.candidates);
    if (before && ahead && ahead.margin > 0 && ahead.leader.name !== before && !isEarly(r) && !r.candidates.some((c) => c.winner)) changed.add(r.id);
  }
  return { at: snap.at, calls, flips, withdrawn, leadChanges: changed.size, changed };
}

const LAST_SEEN = "mt-last-seen";

/**
 * The viewer's last look and what changed since. The first visit records one; leaving the tab or dismissing the
 * banner records another, so coming back shows what happened while away.
 */
export function useSince(races: readonly RaceSummary[]) {
  const [raw, set] = useStored(LAST_SEEN);
  const snap = useMemo(() => parse(raw, isSnapshot), [raw]);
  const since = useMemo(() => (snap ? sinceSnapshot(snap, races) : null), [snap, races]);
  const mark = useCallback(() => set(JSON.stringify(snapshotOf(races))), [races, set]);
  return { since, hasSnapshot: !!snap, mark };
}
