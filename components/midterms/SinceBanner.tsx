"use client";

import { createContext, useEffect } from "react";
import { stampET } from "@/lib/midterms/polls";
import type { RaceSummary } from "@/lib/midterms/view";
import { useSince } from "./seen";

/** Races where someone else leads than when the viewer last looked, for a small marker on their cards. */
const NONE: ReadonlySet<number> = new Set();
export const LeadChanged = createContext(NONE);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Since 9:15 PM: 6 calls, 2 flips, 3 lead changes, 1 withdrawn", until dismissed. The first visit and every time the
 * viewer leaves the tab record a fresh look, so coming back shows only what happened while away.
 */
export function SinceBanner({ races, children }: { races: readonly RaceSummary[]; children?: React.ReactNode }) {
  const { since, hasSnapshot, mark } = useSince(races);
  const counted = races.some((r) => r.total > 0);
  useEffect(() => {
    if (!hasSnapshot && races.length) mark();
  }, [hasSnapshot, races.length, mark]);
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && mark();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", mark);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", mark);
    };
  }, [mark]);
  const parts = since
    ? [
        since.calls && plural(since.calls, "call"),
        since.flips && plural(since.flips, "flip"),
        since.leadChanges && plural(since.leadChanges, "lead change"),
        since.withdrawn && `${since.withdrawn} withdrawn`,
      ].filter(Boolean)
    : [];
  return (
    <LeadChanged.Provider value={since?.changed ?? NONE}>
      {counted && since && parts.length > 0 && (
        <div className="mt-since small" role="status">
          <span>
            <b>Since {stampET(since.at)}:</b> {parts.join(", ")}
          </span>
          <button type="button" className="mt-linkish" onClick={mark} aria-label="Dismiss: mark everything seen">
            Dismiss
          </button>
        </div>
      )}
      {children}
    </LeadChanged.Provider>
  );
}
