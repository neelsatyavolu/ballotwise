"use client";

import { Fragment, useSyncExternalStore } from "react";
import { setTimeZone, viewerZone } from "@/lib/midterms/polls";

const noSubscribe = () => () => {};
const EASTERN = "America/New_York";

/**
 * Shows the tracker's times in the viewer's own zone. The server renders Eastern (it can't know the viewer's zone),
 * and so does hydration, so the HTML matches; right after, the zone switches and the tracker redraws once in it.
 * Viewers in Eastern time never redraw.
 */
export function ZoneRoot({ children }: { children: React.ReactNode }) {
  const zone = useSyncExternalStore(noSubscribe, viewerZone, () => EASTERN);
  // Set before the tracker below renders, so every time it formats uses this zone.
  setTimeZone(zone);
  return <Fragment key={zone}>{children}</Fragment>;
}
