// How much of a race's count is in, in words that don't overstate it.
import type { RaceSummary } from "@/lib/midterms/view";

/**
 * Reporting for a race, short ("44%") and long ("44% reporting"). civicAPI's figure is precincts or ballot batches,
 * not the expected vote, so votes with no figure (or a 0) read "reporting not given", and a full count that isn't
 * called reads "precincts in, ballots may remain" (mail and provisional ballots come after precincts).
 */
export function reportingText(r: Pick<RaceSummary, "total" | "reporting" | "reportingUnknown" | "candidates">): { short: string; long: string; title?: string } {
  if (r.total === 0) return { short: "0%", long: "No results yet" };
  if (r.reportingUnknown || !r.reporting) return { short: "n/a", long: "Reporting not given", title: "civicAPI has votes for this race but no reporting figure" };
  const n = Math.round(r.reporting);
  if (r.reporting >= 99 && !r.candidates.some((c) => c.winner)) {
    return { short: "99%+", long: "Precincts in, ballots may remain", title: `${n}% of precincts or batches in, but mail, provisional and late ballots can still be counted` };
  }
  return { short: `${n}%`, long: `${n}% reporting` };
}
