// How much of a race's count is in, in words that don't overstate it.
import type { RaceSummary } from "@/lib/midterms/view";

/**
 * Reporting for a race, short ("44%") and long ("44% reporting"). civicAPI's figure is precincts or ballot batches,
 * not the expected vote, so votes with no figure (or a 0) read "reporting not given", and a full count that isn't
 * called reads "precincts in, ballots may remain" (mail and provisional ballots come after precincts). DDHQ's figure
 * is its share of the expected vote, and reads that way.
 */
export function reportingText(r: Pick<RaceSummary, "total" | "reporting" | "reportingUnknown" | "candidates" | "expected" | "local">): { short: string; long: string; title?: string } {
  if (r.total === 0) return { short: "0%", long: "No results yet" };
  if (r.reportingUnknown || !r.reporting) return { short: "n/a", long: "Reporting not given", title: "Votes are available, but the source did not provide a reporting figure" };
  const n = Math.round(r.reporting);
  // With DDHQ's expected vote, the figure is its count over that estimate, held under 100% until DDHQ says it's done.
  // (A local race's expected vote is Ballotwise's own, from its county's share counted; its figure stays as given.)
  if (r.expected !== undefined && !r.local) {
    const title = "Decision Desk HQ's count against its estimate of the final vote; it shows at most 99% until the race is done";
    return { short: `${n}%`, long: n >= 99 && !r.candidates.some((c) => c.winner) ? "99% of expected vote, more may remain" : `${n}% of expected vote`, title };
  }
  if (r.reporting >= 99 && !r.candidates.some((c) => c.winner)) {
    return { short: "99%+", long: "Precincts in, ballots may remain", title: `${n}% of precincts or batches in, but mail, provisional and late ballots can still be counted` };
  }
  return { short: `${n}%`, long: `${n}% reporting` };
}
