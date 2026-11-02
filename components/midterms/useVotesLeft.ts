"use client";
// The estimated votes still to count on a race's card (lib/midterms/votesLeft.ts), for the cards and tiles that show
// a race's candidates.

import { useEffect, useState, type RefObject } from "react";
import type { RaceDetail } from "@/lib/midterms/races";
import type { RaceSummary } from "@/lib/midterms/view";
import { votesLeft } from "@/lib/midterms/votesLeft";
import { useLive } from "./hooks";

/** Whether `el` is on screen: false while it's hidden, scrolled away or not yet laid out. */
export function useOnScreen(el: RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting));
    watch.observe(node);
    return () => watch.disconnect();
  }, [el]);
  return on;
}

/** The estimate from a race's counties: the votes left, or null when there are none to estimate. */
export function leftOf(race: RaceDetail | null | undefined): number | null {
  if (!race || race.total === 0) return null;
  const left = votesLeft(race)?.left ?? 0;
  return left > 0 ? left : null;
}

/** Whether the estimate can say anything: votes counted, two candidates to split them, and no call yet. */
const estimable = (race: RaceSummary) => race.total > 0 && race.candidates.length >= 2 && !race.candidates.some((c) => c.winner);

/**
 * The race's estimated votes still to count, or null. The estimate needs the race's counties, so a card loads them
 * only while it's on screen and the race is counting and uncalled.
 */
export function useVotesLeft(race: RaceSummary, onScreen: boolean): number | null {
  const wanted = onScreen && estimable(race);
  const detail = useLive<{ race: RaceDetail }>(wanted ? `/api/midterms/race/${race.id}` : null).data?.race;
  return wanted && detail?.id === race.id ? leftOf(detail) : null;
}
