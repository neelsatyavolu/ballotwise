// The 2024 presidential result for the Senate and House maps' "2024" view: Harris's margin over Trump, in points of the
// whole vote, statewide or in each House district as drawn for 2026 (lib/midterms/lean2026.json, built by
// scripts/build-lean.mjs).
import lean from "./lean2026.json";

const states: Record<string, number> = lean.state;
const districts: Record<string, number> = lean.house;

/** Harris minus Trump statewide in 2024, in points; null for a place with no figure. */
export function stateMargin2024(state: string): number | null {
  return states[state] ?? null;
}

/** Harris minus Trump in 2024 in a House district as drawn for 2026 (an at-large seat is district 0 or null). */
export function districtMargin2024(state: string, district: number | null): number | null {
  return districts[`house:${state}:${district ?? 0}`] ?? null;
}

/** "Trump +13.1", "Harris +14.7", or "Even". */
export function margin2024Label(margin: number): string {
  if (Math.abs(margin) < 0.05) return "Even";
  return `${margin > 0 ? "Harris" : "Trump"} +${Math.abs(margin).toFixed(1)}`;
}
