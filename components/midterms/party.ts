// Party colors for the tracker's results-terminal look.
import { colorOf } from "@/lib/midterms/view";

/** A candidate's party color, with Libertarian (yellow) and Green told apart from other independents (purple). */
export function partyColor(c: { name: string; party: string }): string {
  if (/libertarian/i.test(c.party)) return "var(--lib, var(--oth))";
  if (/green/i.test(c.party)) return "var(--gre, var(--oth))";
  return colorOf(c);
}
