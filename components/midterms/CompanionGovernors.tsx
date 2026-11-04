"use client";
// The companion screen's governors view, laid out like the Senate wall without its tour: the seat count, the national
// map with each state's lead, and the closest races as cards (toss-ups that look set to flip first), as many as fit.

import { useMemo, useRef } from "react";
import { watchFirst } from "@/lib/midterms/explore";
import { showsResults } from "@/lib/midterms/polls";
import type { Overview } from "@/lib/midterms/view";
import { useClock } from "./hooks";
import { SeatHeader, stateFills, withLeads } from "./OfficeView";
import { RaceCard } from "./RaceCard";
import { useRotatingFit } from "./useRotatingFit";
import { ZoomMap } from "./ZoomMap";

const noop = () => {};

export function CompanionGovernors({ data }: { data: Overview }) {
  const races = useMemo(() => data.races.filter((r) => r.office === "governor"), [data]);
  // From election day on, the map drops the forecast and fills in only as results arrive.
  const results = showsResults(useClock(60_000));
  const fills = useMemo(() => withLeads(stateFills("governor", races, data.ratings.updatedAt, results), races), [races, data.ratings.updatedAt, results]);
  const cards = useMemo(() => [...races].sort(watchFirst), [races]);
  const grid = useRef<HTMLUListElement>(null);
  // As many whole cards as fit, never rotating, like the Senate wall's.
  useRotatingFit(grid, null, cards.length > 0);
  return (
    <section className="mt-cgov" aria-label="Governors">
      <SeatHeader office="governor" data={data} />
      <div className="mt-cgov-body">
        <div className="mt-cgov-map">
          <ZoomMap fills={fills} focus={null} onFocus={noop} countyFills={null} raceId={null} label="Map of 2026 governor races" />
        </div>
        <ul className="mt-grid mt-cgov-cards" ref={grid}>
          {cards.map((r) => (
            <RaceCard key={r.id} race={r} starred={null} onStar={noop} limit={2} bare />
          ))}
        </ul>
      </div>
    </section>
  );
}
