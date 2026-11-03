"use client";
// A counting race's map hover card, laid out like its race card: the title with DDHQ Pulse, the candidates as a
// results table, the votes left and how much is in.
import type { ReactNode } from "react";
import { statusOf } from "@/lib/midterms/explore";
import { raceLabel, type RaceSummary } from "@/lib/midterms/view";
import { CandidateTable } from "./CandidateTable";
import { WatchNote } from "./ForecastTip";
import { CardStatus, PulseTag } from "./RaceCard";
import { useVotesLeft } from "./useVotesLeft";

/** `children` go under the table, for a line the map adds (a flip). The card is only mounted while hovered, so it loads the votes-left estimate then. */
export function RaceTip({ race, children }: { race: RaceSummary; children?: ReactNode }) {
  const left = useVotesLeft(race, statusOf(race) === "counting");
  return (
    <div className="mt-race-tip">
      <div className="mt-race-tip-head">
        <b>{raceLabel(race)}</b>
        <PulseTag race={race} />
      </div>
      <CandidateTable race={race} limit={3} short status={<CardStatus race={race} />} left={left} />
      {children && <div className="mt-race-tip-note">{children}</div>}
      <WatchNote race={race} />
    </div>
  );
}
