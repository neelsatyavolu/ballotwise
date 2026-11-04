// The map's Remaining view, as DDHQ's county map has it: a circle per county sized by the votes it has left.
import { useMemo } from "react";
import type { RaceDetail } from "@/lib/midterms/races";
import { approx, votesLeft } from "@/lib/midterms/votesLeft";
import { lastName } from "./CandidateTable";
import { CountyTip } from "./county";
import { partyColor } from "./party";
import type { Bubble, Fill } from "./ZoomMap";

/** Whoever a county's remaining votes favor can't be told: the circle goes grey. */
const UNSURE = "var(--muted)";
/** The counties under the circles: one plain grey, so the circles' colors are the only ones on the map. */
export const QUIET = "color-mix(in srgb, var(--in-race) 55%, var(--sheet))";

/**
 * Each county's circle for the Remaining view, from the votes-left estimate (DDHQ's own expected vote per county on a
 * connected screen), and the county fills beneath them: plain grey, so the circles read, with the votes left in the tip.
 * Null when the race has nothing left to show (no count yet, or every county counted).
 */
export function useRemaining(race: RaceDetail | null | undefined): { bubbles: Bubble[]; fills: Map<string, Fill> } | null {
  // A called race still has votes out, and DDHQ's map keeps showing them: the estimate is read as if it weren't called.
  const est = useMemo(() => (race ? votesLeft({ ...race, candidates: race.candidates.map((c) => ({ ...c, winner: false })) }) : null), [race]);
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
        fill: QUIET,
        tip: (
          <>
            <CountyTip county={c} />
            <div className="mt-ctip-left">
              {l ? (
                <>
                  ~{approx(l.left)} left
                  {leans && (
                    <>
                      {" · leans "}
                      <b style={{ color: partyColor(leans) }}>{lastName(leans.name)}</b>
                    </>
                  )}
                </>
              ) : (
                "Nothing left to count"
              )}
            </div>
          </>
        ),
      });
    }
    return { bubbles: est.counties.map((c) => ({ key: c.fips, size: c.left, color: colorOf(c.party) })), fills };
  }, [race, est]);
}
