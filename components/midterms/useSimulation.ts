"use client";

import type { Overview } from "@/lib/midterms/view";

/**
 * The live overview. Development previews (`?sim=21.5` for 9:30 p.m. Eastern on election night) are now applied by
 * useLive to every live answer on every page, and the clock is set as clock.ts loads, so this passes `data` through.
 */
export function useSimulation(data: Overview | null): Overview | null {
  return data;
}
