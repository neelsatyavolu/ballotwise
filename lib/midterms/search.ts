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

/** Local offices people search for, longest first so "city council" wins over "council". */
const OFFICES = /\b(city council|town council|county commission(?:er)?|board of supervisors|school board|board of education|city attorney|district attorney|county judge|justice of the peace|council|mayor|sheriff|judge|clerk|treasurer|assessor|supervisor|alderman|selectboard)\b/i;

/**
 * A search that names both a place and an office ("palo alto city council"), split into the two, so each can be
 * searched alone when the whole finds nothing. Null when there's only one of them.
 */
export function splitPlace(query: string): { place: string; office: string } | null {
  const hit = OFFICES.exec(query);
  if (!hit) return null;
  const place = `${query.slice(0, hit.index)} ${query.slice(hit.index + hit[0].length)}`.replace(/\b(of|for|in)\b/gi, " ").replace(/\s+/g, " ").trim();
  return place ? { place, office: hit[0] } : null;
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
