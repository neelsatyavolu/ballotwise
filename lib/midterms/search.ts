// Rules for the Search tab, kept free of React so they can be tested on their own.
import type { FoundRace } from "./civic";
import { compareRaces, OFFICE_LABEL, raceLabel, STATE_NAMES, type Office, type RaceSummary } from "./view";

/** The Search tab's filters: everything, or one kind of race. */
export type SearchGroup = "all" | "tracked" | "measures" | "local" | "statewide";

/** Tracked races list in the tabs' order. */
const OFFICE_ORDER: Office[] = ["senate", "house", "governor", "measure"];

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Tracked races (Senate, House, governors, statewide measures) matching every word of `query` somewhere in the race's
 * name, its state or any candidate's name. civicAPI's own search can't find candidates, so this is how "Ossoff" works.
 */
export function matchTracked(races: readonly RaceSummary[], query: string): RaceSummary[] {
  const want = words(query);
  if (!want.length) return [];
  return races
    .filter((r) => {
      const hay = `${raceLabel(r)} ${r.title} ${STATE_NAMES[r.state] ?? ""} ${r.state} ${OFFICE_LABEL[r.office]} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase();
      return want.every((w) => hay.includes(w));
    })
    .sort((a, b) => OFFICE_ORDER.indexOf(a.office) - OFFICE_ORDER.indexOf(b.office) || compareRaces(a, b));
}

/** The candidates in `race` whose names hold any word of `query`, for saying why a race matched: "Austin Knudsen". */
export function matchedCandidates(race: RaceSummary, query: string): string[] {
  const want = words(query);
  return race.candidates.map((c) => c.name).filter((name) => want.some((w) => name.toLowerCase().includes(w)));
}

/** Which filter a civicAPI result falls under: a ballot question, a local race, or another statewide or county one. */
export function foundGroup(r: FoundRace): Exclude<SearchGroup, "all" | "tracked"> {
  if (/referendum|measure|proposition|initiative|question|amendment/i.test(r.type)) return "measures";
  return r.kind === "local" ? "local" : "statewide";
}

/** civicAPI results that aren't already tracked races, which show with their live numbers instead. */
export function untracked(found: readonly FoundRace[], tracked: readonly RaceSummary[]): FoundRace[] {
  const ids = new Set(tracked.map((r) => r.id));
  return found.filter((r) => !ids.has(r.id));
}
