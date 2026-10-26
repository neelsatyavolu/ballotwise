import type { ContestLevel, RaceKind } from "./schema";

/** The tabs on My ballot, in display order. */
export const CATEGORIES = [
  { id: "federal-state", label: "Federal & state" },
  { id: "local", label: "Local offices" },
  { id: "judges", label: "Judges" },
  { id: "propositions", label: "State propositions" },
  { id: "local-measures", label: "Local measures" },
  { id: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];

/** Which tab a contest belongs in. Guides saved before levels were recorded have none and go under Other. */
export function categoryOf(kind: RaceKind | null, level: ContestLevel | null): Category {
  if (kind === "judicial") return "judges";
  if (kind === "measure") return level === "state" || level === "federal" ? "propositions" : "local-measures";
  if (level === "federal" || level === "state") return "federal-state";
  if (level === "judicial") return "judges";
  if (level === null) return "other";
  return "local";
}
