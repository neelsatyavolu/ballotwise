"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { api, ApiError } from "@/lib/client";
import { gridLayoutSchema, isGrid, type GridLayout } from "@/lib/midterms/decisionView";
import type { Dashboard } from "../hooks";

export type GridDashboard = { id: string; layout: GridLayout; updatedAt: number };

/** Guests keep Decision View dashboards in this browser, as they do stars. */
const GUEST_KEY = "mt-dv-dashboards";
export const GUEST_PREFIX = "local-";

function readGuest(): GridDashboard[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((d) => {
      const layout = gridLayoutSchema.safeParse((d as GridDashboard).layout);
      return layout.success && typeof (d as GridDashboard).id === "string" ? [{ id: (d as GridDashboard).id, layout: layout.data, updatedAt: Number((d as GridDashboard).updatedAt) || 0 }] : [];
    });
  } catch {
    return [];
  }
}

function writeGuest(list: GridDashboard[]): boolean {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const onlyGrids = (list: Dashboard[]): GridDashboard[] => list.flatMap((d) => (isGrid(d.layout) ? [{ id: d.id, layout: d.layout, updatedAt: d.updatedAt }] : []));

/**
 * The viewer's Decision View dashboards: on their account when signed in (the same store as Grok's dashboards),
 * otherwise in this browser. `list` is null until loaded.
 */
export function useGridDashboards() {
  const { user, loading } = useAccount();
  const [list, setList] = useState<GridDashboard[] | null>(null);
  const [all, setAll] = useState<Dashboard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
      setList(readGuest());
      return;
    }
    api<{ dashboards: Dashboard[] }>("/api/midterms/dashboards")
      .then((r) => {
        setAll(r.dashboards);
        setList(onlyGrids(r.dashboards));
      })
      .catch(() => setList([]));
  }, [user, loading]);

  const create = useCallback(
    async (layout: GridLayout): Promise<string | null> => {
      setError(null);
      if (!user) {
        const id = `${GUEST_PREFIX}${crypto.randomUUID()}`;
        const next = [...readGuest(), { id, layout, updatedAt: Date.now() }];
        if (!writeGuest(next)) {
          setError("This browser won't save dashboards. Sign in to keep them on your account.");
          return null;
        }
        setList(next);
        return id;
      }
      try {
        const r = await api<{ id: string; dashboards: Dashboard[] }>("/api/midterms/dashboards", { method: "POST", body: { layout } });
        setAll(r.dashboards);
        setList(onlyGrids(r.dashboards));
        return r.id;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't create the dashboard.");
        return null;
      }
    },
    [user],
  );

  const save = useCallback(
    async (id: string, layout: GridLayout): Promise<boolean> => {
      if (id.startsWith(GUEST_PREFIX)) {
        const next = readGuest().map((d) => (d.id === id ? { ...d, layout, updatedAt: Date.now() } : d));
        setList(next);
        return writeGuest(next);
      }
      try {
        await api(`/api/midterms/dashboards/${encodeURIComponent(id)}`, { method: "PUT", body: { layout } });
        setList((prev) => prev?.map((d) => (d.id === id ? { ...d, layout, updatedAt: Date.now() } : d)) ?? prev);
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't save your changes.");
        return false;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    if (id.startsWith(GUEST_PREFIX)) {
      const next = readGuest().filter((d) => d.id !== id);
      writeGuest(next);
      setList(next);
      return;
    }
    try {
      const r = await api<{ dashboards: Dashboard[] }>(`/api/midterms/dashboards/${encodeURIComponent(id)}`, { method: "DELETE" });
      setAll(r.dashboards);
      setList(onlyGrids(r.dashboards));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the dashboard.");
    }
  }, []);

  return { list, all, signedIn: !!user, loading: loading || list === null, error, create, save, remove };
}
