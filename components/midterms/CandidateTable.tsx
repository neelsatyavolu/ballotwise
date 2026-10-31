// Rendered inside the tracker's client components.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { isEarly } from "@/lib/midterms/explore";
import { ballotOrder, fmt, partyTag, type RaceSummary } from "@/lib/midterms/view";
import { pickIn } from "@/lib/midterms/picks";
import { Avatar } from "./Avatar";
import { partyColor } from "./party";
import { PickTag, usePicks } from "./picks";
import { reportingText } from "./reporting";

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
  const text = reportingText(race);
  const known = race.total > 0 && !race.reportingUnknown && race.reporting > 0;
  const pct = known ? Math.min(100, race.reporting) : 0;
  return (
    <div className="mt-ct-in" title={text.title ?? "civicAPI's estimate of precincts or ballot batches reported. Not the share of the expected vote."}>
      <span className="mt-ct-track" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="num">{known && text.short !== "99%+" ? `${Math.round(pct)}%` : text.long}</span>
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
  // A local race found by search is carried as a "measure", but a contest between candidates still gets their columns.
  const measure = race.office === "measure" && race.local?.kind !== "candidates";
  // Before votes, the contenders lead (see ballotOrder), so a card's top rows aren't civicAPI's listing order.
  const ordered = ballotOrder(race);
  const shown = limit ? ordered.slice(0, limit) : ordered;
  const hidden = race.candidates.length - shown.length;
  const early = isEarly(race);
  const cols = measure ? 3 : 4;
  // The voter's best match from their guide for this race. A wide table tags the row; a narrow card has no room beside
  // the name, so it marks the row and names the match in a line under the candidates, as it does for a cut-off row.
  const found = pickIn(race, usePicks());
  const nameOf = (n: string) => (short && !measure ? lastName(n) : n);
  const pickLine = found ? (short ? found.names : found.names.filter((n) => !shown.some((c) => c.name === n))) : [];
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
        {shown.map((c) => {
          const picked = Boolean(found?.names.includes(c.name));
          // On a card the mark sits on the photo's corner, so it takes no room from the name; a measure has no photo.
          const mark = <span className="mt-pick-mark" title="Your match" aria-label="Your match" />;
          const avatar = <Avatar race={race} candidate={c}>{initials(c.name)}</Avatar>;
          return (
            <tr key={c.name} className={c.winner ? "won" : undefined} style={{ "--p": partyColor(c), opacity: early && !c.winner ? 0.85 : undefined } as CSSProperties}>
              <td className="mt-ct-cand" title={c.name}>
                <span className="mt-ct-who">
                  {!measure && (picked && short ? <span className="mt-pick-on">{avatar}{mark}</span> : avatar)}
                  <span className="mt-ct-name">{short && !measure ? lastName(c.name) : c.name}</span>
                  {c.incumbent && <span className="mt-ct-inc" title="Incumbent">*</span>}
                  {c.winner && <span className="mt-check" aria-label="winner"> ✓</span>}
                  {found && picked && (short ? measure && mark : <PickTag found={found} name={c.name} />)}
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
          );
        })}
        {(hidden > 0 || pickLine.length > 0) && (
          <tr className="mt-ct-more">
            <td colSpan={cols}>
              {hidden > 0 && <Link href={`/midterms/${race.id}`}>+{hidden} more</Link>}
              {found && pickLine.length > 0 && <>{hidden > 0 && " "}<PickTag found={found} name={pickLine[0]} label={`Your match: ${pickLine.map(nameOf).join(", ")}`} /></>}
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
          <td className="num">{race.total > 0 && fmt(race.total)}</td>
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
