// Party colors for the tracker's results-terminal look.
import { colorOf } from "@/lib/midterms/view";

/** A candidate's party color, with Libertarian (yellow) and Green told apart from other independents (purple), or civicAPI's color where it gives one. */
export function partyColor(c: { name: string; party: string; color?: string }): string {
  // Candidates in local races found by search carry civicAPI's own colors, since most run without a party.
  if (c.color) return c.color;
  if (/libertarian/i.test(c.party)) return "var(--lib, var(--oth))";
  if (/green/i.test(c.party)) return "var(--gre, var(--oth))";
  return colorOf(c);
}
