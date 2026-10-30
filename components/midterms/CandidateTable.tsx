// Rendered inside the tracker's client components.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { isEarly } from "@/lib/midterms/explore";
import { fmt, partyTag, type RaceSummary } from "@/lib/midterms/view";
import { Avatar } from "./Avatar";
import { partyColor } from "./party";

export const lastName = (name: string) => {
  const parts = name.replace(/,? (Jr|Sr|II|III|IV)\.?$/i, "").split(" ");
  // "de la Cruz", "Van Hollen": keep lowercase particles with the surname.
  let i = parts.length - 1;
  while (i > 0 && /^(de|la|van|von|del|da|di|le)$/i.test(parts[i - 1])) i -= 1;
  return parts.slice(i).join(" ");
};

export const initials = (name: string) => {
  const parts = name.replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + lastName(name)[0]).toUpperCase();
};

/** Party as a results desk abbreviates it: DEM, GOP, LIB, GRE, IND, or the party's own short tag. */
function partyCode(party: string): string {
  if (/^Democrat/i.test(party)) return "DEM";
  if (/^Republican/i.test(party)) return "GOP";
  if (/libertarian/i.test(party)) return "LIB";
  if (/green/i.test(party)) return "GRE";
  if (/independent/i.test(party)) return "IND";
  return partyTag(party).toUpperCase();
}

/** How much of the count is in, as a percentage over a thin track. */
function Reporting({ race }: { race: RaceSummary }) {
  const unknown = race.total > 0 && race.reportingUnknown;
  const pct = race.total > 0 && !unknown ? Math.min(100, race.reporting) : 0;
  return (
    <div className="mt-ct-in" title={unknown ? "civicAPI has votes for this race but no reporting figure" : "civicAPI's estimate of precincts or ballot batches reported. Not the share of the expected vote."}>
      <span className="num">{unknown ? "Reporting unknown" : `${Math.round(pct)}%`}</span>
      <span className="mt-ct-track" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/**
 * A race's candidates as a results-desk table: a party bar, photo or initials, name, party, votes and share on each
 * row, then `status` (when polls close, or how the count stands) with the total votes, then how much is reported.
 * `limit` shows only the leaders, with a link to the rest; `short` uses last names for narrow cards; `share` adds a
 * bar beside each percentage; `fill` stretches the table to its card's height, keeping the footer rows at the bottom.
 */
export function CandidateTable({ race, status, limit, short = false, share = false, fill = false }: { race: RaceSummary; status: ReactNode; limit?: number; short?: boolean; share?: boolean; fill?: boolean }) {
  const measure = race.office === "measure";
  const shown = limit ? race.candidates.slice(0, limit) : race.candidates;
  const hidden = race.candidates.length - shown.length;
  const early = isEarly(race);
  const cols = measure ? 3 : 4;
  return (
    <table className={`mt-ct${fill ? " fill" : ""}`}>
      <thead>
        <tr>
          <th scope="col">{measure ? "Choice" : "Candidate"}</th>
          {!measure && <th scope="col">Party</th>}
          <th scope="col" className="num">Votes</th>
          <th scope="col" className="num">Pct</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((c) => (
          <tr key={c.name} className={c.winner ? "won" : undefined} style={{ "--p": partyColor(c), opacity: early && !c.winner ? 0.85 : undefined } as CSSProperties}>
            <td className="mt-ct-cand" title={c.name}>
              <span className="mt-ct-who">
                {!measure && <Avatar race={race} candidate={c}>{initials(c.name)}</Avatar>}
                <span className="mt-ct-name">{short && !measure ? lastName(c.name) : c.name}</span>
                {c.incumbent && <span className="mt-ct-inc" title="Incumbent">*</span>}
                {c.winner && <span className="mt-check" aria-label="winner"> ✓</span>}
              </span>
            </td>
            {!measure && <td className="mt-ct-party">{partyCode(c.party)}</td>}
            <td className="num">{fmt(c.votes)}</td>
            <td className="num">
              {share && (
                <span className="mt-share" aria-hidden>
                  <span style={{ width: `${c.pct}%`, background: partyColor(c) }} />
                </span>
              )}
              {c.pct.toFixed(2)}%
            </td>
          </tr>
        ))}
        {hidden > 0 && (
          <tr className="mt-ct-more">
            <td colSpan={cols}>
              <Link href={`/midterms/${race.id}`}>+{hidden} more</Link>
            </td>
          </tr>
        )}
        {fill && (
          <tr className="mt-ct-fill" aria-hidden>
            <td colSpan={cols} />
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr className="mt-ct-status">
          <td colSpan={cols - 2}>{status}</td>
          <td className="num">{fmt(race.total)}</td>
          <td />
        </tr>
        <tr className="mt-ct-report">
          <td colSpan={cols}>
            <Reporting race={race} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
