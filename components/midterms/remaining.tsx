// The map's Remaining view, as DDHQ's county map has it: a circle per county sized by the votes it has left.
import { useMemo } from "react";
import type { RaceDetail } from "@/lib/midterms/races";
import { approx, votesLeft } from "@/lib/midterms/votesLeft";
import { CountyTip, fillFor } from "./county";
import { partyColor } from "./party";
import type { Bubble, Fill } from "./ZoomMap";

/** Whoever a county's remaining votes favor can't be told: the circle goes grey. */
const UNSURE = "var(--muted)";

/**
 * Each county's circle for the Remaining view, from the votes-left estimate (DDHQ's own expected vote per county on a
 * connected screen), and the county fills beneath them: plain, so the circles read, with the votes left in the tip.
 * Null when the race has nothing left to show (no count yet, or called).
 */
export function useRemaining(race: RaceDetail | null | undefined): { bubbles: Bubble[]; fills: Map<string, Fill> } | null {
  const est = useMemo(() => (race ? votesLeft(race) : null), [race]);
  return useMemo(() => {
    if (!race || !est?.counties.length) return null;
    const colorOf = (party: string | null) => {
      const c = party && race.candidates.find((x) => x.party === party);
      return c ? partyColor(c) : UNSURE;
    };
    const left = new Map(est.counties.map((c) => [c.fips, c]));
    const fills = new Map<string, Fill>();
    for (const c of race.counties) {
      if (!c.fips) continue;
      const l = left.get(c.fips);
      const leans = l?.party && race.candidates.find((x) => x.party === l.party);
      fills.set(c.fips, {
        fill: `color-mix(in srgb, ${fillFor(c, "results")} 35%, var(--sheet))`,
        tip: (
          <>
            <CountyTip county={c} />
            <div className="small">{l ? `About ${approx(l.left)} votes left${leans ? `, leaning ${leans.name}` : ""}` : "Nothing left to count, by the estimate"}</div>
          </>
        ),
      });
    }
    return { bubbles: est.counties.map((c) => ({ key: c.fips, left: c.left, color: colorOf(c.party) })), fills };
  }, [race, est]);
}

/** The race card's switch for the Remaining view, beside its star. */
export function RemainingButton({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={`mt-remaining${on ? " on" : ""}`} aria-pressed={on} onClick={() => onChange(!on)} title="Remaining: a circle on each county sized by the votes it has left, colored for whoever they favor">
      Remaining
    </button>
  );
}
