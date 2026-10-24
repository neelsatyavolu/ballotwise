import type { Office, RaceSummary } from "./races";

/** How many races of each office are on the ballot this cycle (33 regular and 2 special Senate seats). Measures vary. */
export const EXPECTED = { senate: 35, house: 435, governor: 36 } as const;

/** Per office: races in the served catalog (missing ones included), how many of those are missing, and how many should exist. */
export type Coverage = Record<Office, { listed: number; missing: number; expected: number | null }>;

export function coverageOf(races: readonly RaceSummary[]): Coverage {
  const count = (office: Office, expected: number | null) => {
    const listed = races.filter((r) => r.office === office);
    return { listed: listed.length, missing: listed.filter((r) => r.missing).length, expected };
  };
  return { senate: count("senate", EXPECTED.senate), house: count("house", EXPECTED.house), governor: count("governor", EXPECTED.governor), measure: count("measure", null) };
}
