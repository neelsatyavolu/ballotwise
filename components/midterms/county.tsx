// County shading and hover cards shared by the race page and the zoomable office maps.
import type { CountyResult } from "@/lib/midterms/races";
import { fmt, lead, marginLabel, pct, shade } from "@/lib/midterms/view";
import type { CSSProperties } from "react";
import { lastName, partyCode } from "./CandidateTable";
import { partyColor } from "./party";

export type Mode = "results" | "reporting" | "2024";

/** Fill for a county in the race on show. Before it has votes, a county still gets the "in this race" tint, so picking a race highlights where it is. */
export function fillFor(county: CountyResult, mode: Mode): string {
  if (mode === "reporting") return county.reporting > 0 ? `color-mix(in srgb, var(--accent) ${Math.round(15 + county.reporting * 0.75)}%, var(--sheet))` : "var(--in-race)";
  if (mode === "2024") {
    const m = county.baseline2024;
    return m === null ? "var(--rule)" : shade(m > 0 ? "var(--dem)" : "var(--rep)", Math.abs(m));
  }
  const ahead = lead(county.candidates);
  return ahead ? shade(partyColor(ahead.leader), ahead.margin) : "var(--in-race)";
}

/** Hover card for a county: this race's count, or in "2024" mode the 2024 presidential vote. */
export function CountyTip({ county, mode = "results" }: { county: CountyResult; mode?: Mode }) {
  const p = county.pres2024;
  if (mode === "2024") {
    const rows = p ? [{ name: "Kamala Harris", color: "var(--dem)", votes: p.harris }, { name: "Donald Trump", color: "var(--rep)", votes: p.trump }] : [];
    return (
      <>
        <b>{county.name}</b>
        {p ? (
          <table>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name}>
                  <td>
                    <span className="swatch" style={{ background: c.color }} /> {c.name}
                  </td>
                  <td className="num">{fmt(c.votes)}</td>
                  <td className="num">{pct((c.votes / p.total) * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <span className="muted">{county.baseline2024 !== null ? `2024 president: ${marginLabel(county.baseline2024)}` : "No 2024 county result"}</span>
      </>
    );
  }
  // Laid out like DDHQ's county card: a party bar on each row, last name and party, then how much is in.
  const counted = county.total > 0 && !county.reportingUnknown;
  const shown = Math.min(100, Math.round(county.reporting));
  return (
    <div className="mt-ctip">
      <table>
        <thead>
          <tr>
            <th scope="col">{county.name}</th>
            <th scope="col" className="num">Votes</th>
            <th scope="col" className="num">Pct</th>
          </tr>
        </thead>
        <tbody>
          {county.candidates.slice(0, 4).map((c) => (
            <tr key={c.name} style={{ "--p": partyColor(c) } as CSSProperties}>
              <td title={c.name}>
                {lastName(c.name)}
                {partyCode(c.party) && ` (${partyCode(c.party)})`}
              </td>
              <td className="num">{fmt(c.votes)}</td>
              <td className="num">{c.pct.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-ctip-foot">
        <span className="muted">{county.baseline2024 !== null ? `2024 ${marginLabel(county.baseline2024)}` : ""}</span>
        {/* DDHQ's share is of its expected vote ("Est."); civicAPI's counts precincts. */}
        <span className="mt-ctip-in" title={county.expected ? "Votes counted, as a share of DDHQ's estimate of the county's final vote" : "Precincts or ballot batches reported (civicAPI)"}>
          {counted ? `${county.done ? 100 : shown}% ${county.expected ? "Est." : "in"}` : county.total > 0 ? "Counting" : "No votes yet"}
          <span className="mt-ct-track" aria-hidden>
            <span style={{ width: `${counted ? (county.done ? 100 : shown) : 0}%` }} />
          </span>
        </span>
      </div>
    </div>
  );
}
