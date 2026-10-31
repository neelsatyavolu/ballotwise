// The past elections on the precinct map (scripts/build-precincts.mjs builds their tiles and summaries).

export type Office = "president" | "senate" | "governor";

export const OFFICES: { id: Office; label: string }[] = [
  { id: "president", label: "President" },
  { id: "senate", label: "Senate" },
  { id: "governor", label: "Governor" },
];

/** Newest first within each office; the first is the one the map opens on. */
export const ELECTIONS: { id: string; office: Office; year: number; label?: string }[] = [
  { id: "2024-president", office: "president", year: 2024 },
  { id: "2020-president", office: "president", year: 2020 },
  { id: "2016-president", office: "president", year: 2016 },
  { id: "2018-senate", office: "senate", year: 2018 },
  // Minnesota's special election and Mississippi's special runoff, for each state's other seat.
  { id: "2018-senate-special", office: "senate", year: 2018, label: "2018 special" },
  { id: "2018-governor", office: "governor", year: 2018 },
];

/** Tiles live in R2 behind custom-worker.ts; NEXT_PUBLIC_PAST_TILES points `next dev` at a local copy instead. */
const TILES = process.env.NEXT_PUBLIC_PAST_TILES ?? "/midterms/past-tiles";
export const tilesUrl = (id: string) => `pmtiles://${new URL(`${TILES}/${id}.pmtiles`, location.href).href}`;
export const summaryUrl = (id: string) => `/midterms/past/${id}.json`;
