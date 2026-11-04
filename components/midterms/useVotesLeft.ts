"use client";
// The estimated votes still to count on a race's card (lib/midterms/votesLeft.ts), for the cards and tiles that show
// a race's candidates.

import { useEffect, useState, type RefObject } from "react";
import type { RaceDetail } from "@/lib/midterms/races";
import type { RaceSummary } from "@/lib/midterms/view";
import { votesLeft, type Share } from "@/lib/midterms/votesLeft";
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

/** The votes still to count, and who they'd add the most to and by how many (null when they'd split about evenly). */
export type LeftEstimate = { left: number; favors: Share | null; net: number };

/** Below this share of the votes left, the two leaders' gains from them read as an even split. */
const EVEN_SHARE = 0.01;

/** The estimate from a race's counties, or null when there are no votes left to estimate. */
export function leftOf(race: RaceDetail | null | undefined): LeftEstimate | null {
  if (!race || race.total === 0) return null;
  const est = votesLeft(race);
  if (!est || est.left <= 0) return null;
  const net = Math.abs(est.leader.votes - est.runnerUp.votes);
  const favors = net < est.left * EVEN_SHARE ? null : est.leader.votes > est.runnerUp.votes ? est.leader : est.runnerUp;
  return { left: est.left, favors, net };
}

/** Whether the estimate can say anything: votes counted, two candidates to split them, and no call yet. */
const estimable = (race: RaceSummary) => race.total > 0 && race.candidates.length >= 2 && !race.candidates.some((c) => c.winner);

/**
 * The race's estimated votes still to count, or null. The estimate needs the race's counties, so a card loads them
 * once it has been on screen, while the race is counting and uncalled. It keeps them after it's hidden: a card in a
 * grid that hides what doesn't fit (useRotatingFit) would otherwise lose its votes-left row when hidden, fit again,
 * come back, regain the row and be hidden again, flickering.
 */
export function useVotesLeft(race: RaceSummary, onScreen: boolean): LeftEstimate | null {
  const [seen, setSeen] = useState(false);
  if (onScreen && !seen) setSeen(true);
  const wanted = (onScreen || seen) && estimable(race);
  const detail = useLive<{ race: RaceDetail }>(wanted ? `/api/midterms/race/${race.id}` : null).data?.race;
  return wanted && detail?.id === race.id ? leftOf(detail) : null;
}
