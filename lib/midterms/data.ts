import baselineJson from "./baseline2024.json";
import measuresJson from "./measures.json";

/** 2024 presidential vote by county FIPS: [Harris, Trump, total]. */
export const BASELINE_2024 = baselineJson as unknown as Record<string, [number, number, number]>;

/** Ballotpedia's one-line summary of each statewide measure, keyed by civicAPI's race name. Built by scripts/build-measures.mjs. */
export const MEASURES = measuresJson as Record<string, { summary: string; url: string }>;
