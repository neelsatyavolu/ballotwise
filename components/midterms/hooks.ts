"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccount } from "@/components/AccountProvider";
import { api, ApiError } from "@/lib/client";
import { clockNow, simAt } from "@/lib/midterms/clock";
import { fetchLive, isLagging, isNewer, LIVE_TIMEOUT_MS, LiveError, pollInterval, retryDelay } from "@/lib/midterms/live";
import type { GridLayout } from "@/lib/midterms/decisionView";

export { ELECTION_POLL_MS, POLL_MS, pollInterval } from "@/lib/midterms/live";

/** What a page holds for one path: the data shown, the ETag it came with, and the server's latest fetch time. */
type Held<T> = { path: string; data: T; etag: string | null; fetchedAt: number | null };

/** Development previews (`?sim=`) run every live answer through the made-up election night, on every page. */
async function previewed<T>(path: string, data: T): Promise<T> {
  const at = simAt();
  if (process.env.NODE_ENV !== "development" || at === null) return data;
  const sim = await import("@/lib/midterms/sim");
  return sim.simulatePayload(path, data, at);
}

/**
 * Fetches `path` now and again after each answer while the tab is visible, keeping the last good data through
 * errors. A null path fetches nothing. One request is in flight at a time and the next is scheduled once it settles,
 * so slow answers can't pile up or overtake each other; the wait is re-read every time (see pollInterval), a request
 * is given up after LIVE_TIMEOUT_MS, and failures back off (see retryDelay). An answer the server says is unchanged
 * (a 304) or that's no newer than the one shown keeps the same data object, so the page doesn't redraw.
 *
 * `now` ticks with each poll so "updated X ago" labels stay current. `interval` is the current wait between polls.
 * `fetchedAt` is when the server last fetched these results (even when the answer was unchanged), and `lagging` is
 * set once that's LAG_MS or more ago.
 */
export function useLive<T>(path: string | null) {
  // Data is kept with the path it came from, so switching paths never shows the previous one's numbers.
  const [state, setState] = useState<Held<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [interval, setIntervalMs] = useState(() => pollInterval(clockNow()));
  // The same as `state`, readable from the polling loop without restarting it.
  const held = useRef<Held<T> | null>(null);

  useEffect(() => {
    if (!path) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: AbortController | null = null;
    let failures = 0;
    let done = false;

    const take = (answer: Awaited<ReturnType<typeof fetchLive<T>>>, data: T | null) => {
      const prev = held.current?.path === path ? held.current : null;
      const fetchedAt = Math.max(answer.fetchedAt ?? 0, prev?.fetchedAt ?? 0) || null;
      let next: Held<T> | null = prev;
      if (data !== null && (!prev || isNewer(prev.data, data, answer.etag !== prev.etag))) next = { path, data, etag: answer.etag, fetchedAt };
      else if (prev && fetchedAt !== prev.fetchedAt) next = { ...prev, etag: answer.etag ?? prev.etag, fetchedAt };
      if (next && next !== prev) {
        held.current = next;
        setState(next);
      }
    };

    const poll = async () => {
      timer = null;
      const wait = pollInterval(clockNow());
      const controller = new AbortController();
      inFlight = controller;
      const timeout = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
      try {
        const etag = held.current?.path === path ? held.current.etag : null;
        const answer = await fetchLive<T>(path, etag, controller.signal);
        const data = answer.same ? null : await previewed(path, answer.data);
        if (done) return;
        take(answer, data);
        failures = 0;
        setError(null);
      } catch (err) {
        if (done) return;
        failures += 1;
        setError(err instanceof LiveError || err instanceof ApiError ? err.message : "Couldn't load results.");
      } finally {
        clearTimeout(timeout);
        inFlight = null;
        if (!done) {
          setNow(Date.now());
          setIntervalMs(wait);
          if (!document.hidden) timer = setTimeout(() => void poll(), failures ? retryDelay(wait, failures) : wait);
        }
      }
    };

    // Coming back to the tab asks at once; leaving it lets a request in flight finish but schedules nothing more.
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else if (!timer && !inFlight) void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [path]);

  const mine = state && state.path === path ? state : null;
  const fetchedAt = mine?.fetchedAt ?? null;
  return { data: mine ? mine.data : null, error, now, interval, fetchedAt, lagging: isLagging(fetchedAt, now) };
}

/** The signed-in voter's starred races. `ids` is null when signed out. */
export function useFavorites() {
  const { user, loading } = useAccount();
  const [ids, setIds] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (loading || !user) return;
    api<{ raceIds: number[] }>("/api/midterms/favorites")
      .then((r) => setIds(r.raceIds))
      .catch(() => setIds([]));
  }, [user, loading]);

  const send = useCallback((method: "POST" | "DELETE", body: unknown, optimistic: (prev: number[]) => number[]) => {
    const call = ++pending.current;
    setIds((prev) => optimistic(prev ?? []));
    setError(null);
    // Writes go one at a time, in tap order, so a quick star-unstar can't land in the wrong order on the server.
    // The returned promise says whether this write was saved.
    const step = queue.current.then(async () => {
      try {
        const r = await api<{ raceIds: number[] }>("/api/midterms/favorites", { method, body });
        // Only the latest tap's answer is shown, so quick taps don't flicker.
        if (call === pending.current) setIds(r.raceIds);
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't save that star.");
        const r = await api<{ raceIds: number[] }>("/api/midterms/favorites").catch(() => null);
        if (r) setIds(r.raceIds);
        return false;
      }
    });
    queue.current = step.then(() => undefined);
    return step;
  }, []);

  const toggle = useCallback(
    (id: number) => {
      if (ids?.includes(id)) void send("DELETE", { raceId: id }, (prev) => prev.filter((x) => x !== id));
      else void send("POST", { raceIds: [id] }, (prev) => [id, ...prev]);
    },
    [ids, send],
  );

  const addMany = useCallback((add: number[]) => send("POST", { raceIds: add }, (prev) => [...add.filter((id) => !prev.includes(id)), ...prev]), [send]);

  // Signed out, there's no list at all (null), not an empty one.
  return { ids: user ? ids : null, signedIn: !!user, loading: loading || (!!user && ids === null), error, toggle, addMany };
}

export type DashboardLayout = { title: string; sections: { title: string; note: string; raceIds: number[] }[] };
/** A Grok-built dashboard (sections of race cards) or a Decision View grid of panels. */
export type Dashboard = { id: string; layout: DashboardLayout | GridLayout; updatedAt: number };

/** The signed-in voter's dashboards and which one is open. `list` is null until loaded or when signed out. */
export function useDashboards() {
  const { user, loading } = useAccount();
  const [list, setList] = useState<Dashboard[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    api<{ dashboards: Dashboard[] }>("/api/midterms/dashboards")
      .then((r) => {
        setList(r.dashboards);
        setOpenId((id) => id ?? r.dashboards[0]?.id ?? null);
      })
      .catch(() => setList([]));
  }, [user, loading]);

  const change = useCallback(async (id: string, method: "PATCH" | "DELETE", body?: unknown) => {
    setError(null);
    try {
      const r = await api<{ dashboards: Dashboard[] }>(`/api/midterms/dashboards/${encodeURIComponent(id)}`, { method, body });
      setList(r.dashboards);
      if (method === "DELETE") setOpenId(r.dashboards[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that change.");
    }
  }, []);

  const rename = useCallback((id: string, title: string) => change(id, "PATCH", { title }), [change]);
  const remove = useCallback((id: string) => change(id, "DELETE"), [change]);
  /** Takes the dashboards a chat turn returned and opens the one it touched. */
  const applyChat = useCallback((dashboards: Dashboard[], focusId: string | null) => {
    setList(dashboards);
    setOpenId(focusId);
  }, []);

  return { list: user ? list : null, openId, setOpenId, error, rename, remove, applyChat };
}

/** The current time, ticking every `ms` (every second by default) for countdowns and "polls close" labels. */
export function useClock(ms = 1000) {
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(clockNow()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

const GUEST_KEY = "mt-guest-stars";
const GUEST_CHANGED = "mt-guest-stars";

function readGuest(): string {
  try {
    return localStorage.getItem(GUEST_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribeGuest(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(GUEST_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(GUEST_CHANGED, onChange);
  };
}

/**
 * Starred races for everyone: the account's list when signed in, otherwise one kept in this browser.
 * `guest` says which, so the page can offer to sign in and keep stars on every device.
 */
export function useStars() {
  const favorites = useFavorites();
  const raw = useSyncExternalStore(subscribeGuest, readGuest, () => "[]");
  const guestIds = useMemo(() => parseIds(raw), [raw]);
  const guest = !favorites.signedIn && !favorites.loading;
  const toggleGuest = useCallback(
    (id: number) => {
      const next = guestIds.includes(id) ? guestIds.filter((x) => x !== id) : [id, ...guestIds];
      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify(next));
      } catch {
        // Storage can be off in a private window; the star then won't stick.
      }
      window.dispatchEvent(new Event(GUEST_CHANGED));
    },
    [guestIds],
  );
  // Stars made before signing in move into the account once; the browser's list is cleared only after the account saved them.
  const { signedIn, addMany } = favorites;
  const moving = useRef(false);
  useEffect(() => {
    if (!signedIn || !guestIds.length || moving.current) return;
    moving.current = true;
    void addMany(guestIds).then((saved) => {
      moving.current = false;
      if (!saved) return;
      try {
        localStorage.removeItem(GUEST_KEY);
      } catch {
        // Nothing to clear if storage is off.
      }
      window.dispatchEvent(new Event(GUEST_CHANGED));
    });
  }, [signedIn, guestIds, addMany]);
  const addGuest = useCallback(
    async (add: number[]) => {
      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify([...add.filter((id) => !guestIds.includes(id)), ...guestIds]));
      } catch {
        // Storage can be off in a private window.
        return false;
      }
      window.dispatchEvent(new Event(GUEST_CHANGED));
      return true;
    },
    [guestIds],
  );
  if (guest) return { ids: guestIds, toggle: toggleGuest, addMany: addGuest, guest, loading: false, error: null };
  return { ids: favorites.ids, toggle: favorites.toggle, addMany: favorites.addMany, guest, loading: favorites.loading, error: favorites.error };
}

function parseIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    // A corrupt list starts over empty.
    return [];
  }
}
