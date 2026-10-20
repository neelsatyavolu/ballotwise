"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { api, ApiError } from "@/lib/client";

/** How often an open tracker page asks for new results. */
export const POLL_MS = 30_000;

/**
 * Fetches `path` now and every POLL_MS while the tab is visible, keeping the last good data through errors.
 * A null path fetches nothing.
 * `now` ticks with each poll so "updated X ago" labels stay current.
 */
export function useLive<T>(path: string | null) {
  // Data is kept with the path it came from, so switching paths never shows the previous one's numbers.
  const [state, setState] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const current = useRef(path);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api<T>(path);
      // A slow answer for a path the page has moved on from is dropped.
      if (current.current !== path) return;
      setState({ path, data });
      setError(null);
    } catch (err) {
      if (current.current === path) setError(err instanceof ApiError ? err.message : "Couldn't load results.");
    } finally {
      setNow(Date.now());
    }
  }, [path]);

  useEffect(() => {
    current.current = path;
    if (!path) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void load();
      timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, path]);

  return { data: state && state.path === path ? state.data : null, error, now };
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
    queue.current = queue.current.then(async () => {
      try {
        const r = await api<{ raceIds: number[] }>("/api/midterms/favorites", { method, body });
        // Only the latest tap's answer is shown, so quick taps don't flicker.
        if (call === pending.current) setIds(r.raceIds);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't save that star.");
        const r = await api<{ raceIds: number[] }>("/api/midterms/favorites").catch(() => null);
        if (r) setIds(r.raceIds);
      }
    });
  }, []);

  const toggle = useCallback(
    (id: number) => {
      if (ids?.includes(id)) void send("DELETE", { raceId: id }, (prev) => prev.filter((x) => x !== id));
      else void send("POST", { raceIds: [id] }, (prev) => [id, ...prev]);
    },
    [ids, send],
  );

  const addMany = useCallback((add: number[]) => void send("POST", { raceIds: add }, (prev) => [...add.filter((id) => !prev.includes(id)), ...prev]), [send]);

  // Signed out, there's no list at all (null), not an empty one.
  return { ids: user ? ids : null, signedIn: !!user, loading: loading || (!!user && ids === null), error, toggle, addMany };
}

export type DashboardLayout = { title: string; sections: { title: string; note: string; raceIds: number[] }[] };
export type Dashboard = { id: string; layout: DashboardLayout; updatedAt: number };

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
