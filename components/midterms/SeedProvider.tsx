"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_SEEDS, type TrackerSeeds } from "./seeds";

const SeedContext = createContext<TrackerSeeds>(EMPTY_SEEDS);
/** The server's clock for this render, so "12s ago" matches in the HTML and on hydration. */
const RenderedAtContext = createContext<number | null>(null);

export function SeedProvider({ value, renderedAt = null, children }: { value: TrackerSeeds; renderedAt?: number | null; children: ReactNode }) {
  return (
    <SeedContext.Provider value={value}>
      <RenderedAtContext.Provider value={renderedAt}>{children}</RenderedAtContext.Provider>
    </SeedContext.Provider>
  );
}

export const useTrackerSeeds = () => useContext(SeedContext);
export const useRenderedAt = () => useContext(RenderedAtContext);
