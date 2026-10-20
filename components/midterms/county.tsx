// County shading and hover cards shared by the race page and the zoomable office maps.
import type { CountyResult } from "@/lib/midterms/races";
import { colorOf, fmt, lead, marginLabel, pct, shade } from "@/lib/midterms/view";

export type Mode = "results" | "reporting" | "2024";

/** Fill for a county in the race on show. Before it has votes, a county still gets the "in this race" tint, so picking a race highlights where it is. */
export function fillFor(county: CountyResult, mode: Mode): string {
  if (mode === "reporting") return county.reporting > 0 ? `color-mix(in srgb, var(--accent) ${Math.round(15 + county.reporting * 0.75)}%, var(--sheet))` : "var(--in-race)";
  if (mode === "2024") {
    const m = county.baseline2024;
    return m === null ? "var(--rule)" : shade(m > 0 ? "var(--dem)" : "var(--rep)", Math.abs(m));
  }
  const ahead = lead(county.candidates);
  return ahead ? shade(colorOf(ahead.leader), ahead.margin) : "var(--in-race)";
}

export function CountyTip({ county }: { county: CountyResult }) {
  return (
    <>
      <b>{county.name}</b>
      <table>
        <tbody>
          {county.candidates.slice(0, 4).map((c) => (
            <tr key={c.name}>
              <td>
                <span className="swatch" style={{ background: colorOf(c) }} /> {c.name}
              </td>
              <td className="num">{fmt(c.votes)}</td>
              <td className="num">{pct(c.pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="muted">
        {Math.round(county.reporting)}% reporting{county.baseline2024 !== null && ` · 2024: ${marginLabel(county.baseline2024)}`}
      </span>
    </>
  );
}
