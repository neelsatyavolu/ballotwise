// The race map's views beyond who leads, as DDHQ's county map has them: Margin (a circle per county sized by its lead
// in votes), Swing (an arrow per county for its shift from the 2024 presidential vote) and Remaining (votes left).
import { useMemo, type ReactNode } from "react";
import { countyLeads, countySwings, swingSides, swingSummary } from "@/lib/midterms/countyShift";
import type { RaceDetail } from "@/lib/midterms/races";
import { fmt, marginLabel } from "@/lib/midterms/view";
import { lastName } from "./CandidateTable";
import { CountyTip } from "./county";
import { partyColor } from "./party";
import { QUIET, useRemaining } from "./remaining";
import type { Arrow, Bubble, Fill } from "./ZoomMap";

export type MapMode = "results" | "margin" | "swing" | "remaining";
const LABEL: Record<MapMode, string> = { results: "Results", margin: "Margin", swing: "Swing", remaining: "Remaining" };
const HINT: Record<MapMode, string> = {
  results: "Each county shaded for its leader",
  margin: "A circle on each county sized by its leader's lead in votes",
  swing: "An arrow on each county for how far it has moved from the 2024 presidential vote",
  remaining: "A circle on each county sized by the votes it has left, colored for whoever they favor",
};

type View = { fills: Map<string, Fill>; bubbles?: Bubble[]; arrows?: Arrow[]; note: ReactNode };

/** A county's usual card with one more line under it. */
function tipWith(county: RaceDetail["counties"][number], line: ReactNode) {
  return (
    <>
      <CountyTip county={county} />
      <div className="mt-ctip-left">{line}</div>
    </>
  );
}

function marginView(race: RaceDetail): View | null {
  const leads = countyLeads(race.counties);
  if (!leads.length) return null;
  const byFips = new Map(leads.map((l) => [l.fips, l]));
  const fills = new Map<string, Fill>();
  for (const c of race.counties) {
    if (!c.fips) continue;
    const l = byFips.get(c.fips);
    fills.set(c.fips, { fill: QUIET, tip: tipWith(c, l ? `${lastName(l.leader.name)} ahead by ${fmt(l.votes)} votes` : "No lead yet") });
  }
  const names = new Map(race.counties.map((c) => [c.fips, c.name]));
  const top = [...leads].sort((a, b) => b.votes - a.votes).slice(0, 3);
  return {
    fills,
    bubbles: leads.map((l) => ({ key: l.fips, size: l.votes, color: partyColor(l.leader) })),
    note: (
      <>
        Biggest leads:{" "}
        {top.map((l, i) => (
          <span key={l.fips}>
            {i > 0 && ", "}
            {names.get(l.fips)} (<b style={{ color: partyColor(l.leader) }}>{lastName(l.leader.name)}</b> +{fmt(l.votes)})
          </span>
        ))}
      </>
    ),
  };
}

function swingView(race: RaceDetail): View | null {
  const sides = swingSides(race);
  const swings = countySwings(race);
  const summary = swingSummary(swings);
  if (!sides || !summary) return null;
  const left = partyColor(sides.left);
  const right = partyColor(sides.right);
  // Shifts read as D+/R+ when the left side is a Democrat; otherwise by the candidates' names.
  const toward = (shift: number) => (/^Democrat/i.test(sides.left.party) ? marginLabel(shift) : Math.abs(shift) < 0.05 ? "no change" : `${lastName((shift > 0 ? sides.left : sides.right).name)} +${Math.abs(shift).toFixed(1)}`);
  const byFips = new Map(swings.map((s) => [s.fips, s]));
  const fills = new Map<string, Fill>();
  for (const c of race.counties) {
    if (!c.fips) continue;
    const s = byFips.get(c.fips);
    fills.set(c.fips, {
      fill: QUIET,
      tip: tipWith(c, s ? <>Now {toward(s.now)} · shift <b style={{ color: s.shift > 0 ? left : right }}>{toward(s.shift)}</b></> : c.baseline2024 === null ? "No 2024 county result to compare" : "No votes yet"),
    });
  }
  return {
    fills,
    arrows: swings.map((s) => ({ key: s.fips, shift: s.shift, color: s.shift > 0 ? left : right })),
    note: (
      <>
        Comparing to 2024 president. The {summary.counties} {summary.counties === 1 ? "county" : "counties"} with votes have moved{" "}
        <b style={{ color: summary.shift > 0 ? left : right }}>{toward(summary.shift)}</b>, weighted by votes counted
        {summary.flipped > 0 && `; ${summary.flipped} ${summary.flipped === 1 ? "has" : "have"} a different leader than in 2024`}.
      </>
    ),
  };
}

/**
 * The map views a shown race offers, with each one's county fills, circles or arrows and a line about it. Results is
 * always offered; the others once the race has what they need.
 */
export function useMapModes(race: RaceDetail | null | undefined): { modes: MapMode[]; views: Partial<Record<MapMode, View>> } {
  const remaining = useRemaining(race);
  return useMemo(() => {
    const views: Partial<Record<MapMode, View>> = {};
    if (race) {
      const margin = marginView(race);
      const swing = swingView(race);
      if (margin) views.margin = margin;
      if (swing) views.swing = swing;
    }
    if (remaining) views.remaining = { ...remaining, note: null };
    const modes = (["results", "margin", "swing", "remaining"] as const).filter((m) => m === "results" || views[m]);
    return { modes, views };
  }, [race, remaining]);
}

/** The switch between the map's views, with a line on what the picked one shows. */
export function MapModeSwitch({ modes, mode, onChange, note }: { modes: MapMode[]; mode: MapMode; onChange: (mode: MapMode) => void; note?: ReactNode }) {
  if (modes.length < 2) return null;
  return (
    <div className="mt-map-modes">
      <div className="mt-seg" role="group" aria-label="Map shows">
        {modes.map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)} title={HINT[m]}>
            {LABEL[m]}
          </button>
        ))}
      </div>
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}
