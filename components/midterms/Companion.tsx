"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { adoptMock } from "@/lib/midterms/clock";
import type { Panel } from "@/lib/midterms/screens";
import type { Overview } from "@/lib/midterms/view";
import { CallsFeed } from "./CallsFeed";
import { ControlStrip } from "./ControlStrip";
import { LiveProjection } from "./LiveProjection";
import { useLive, useStars } from "./hooks";
import { MomentPopup } from "./MomentPopup";
import { PollSchedule } from "./PollClose";
import { setSolo, useScreens } from "./useScreens";

const noSubscribe = () => () => {};

/** Mounted only on a companion, so other tabs don't fetch or load stars for it. */
function Body({ hidden }: { hidden: readonly Panel[] }) {
  const data = useLive<Overview>("/api/midterms").data;
  const stars = useStars();
  const shows = (p: Panel) => hidden.includes(p);
  return (
    <>
      <header className="mt-companion-bar">
        <b>Companion screen</b>
        <span className="muted small">The live projection, and what your main screen doesn&apos;t show.</span>
        {data && <MomentPopup data={data} starred={stars.ids} inCompanion />}
        <button type="button" className="mt-el-quiet small" onClick={() => setSolo(true)}>Use this tab normally</button>
      </header>
      {data ? <Panels data={data} shows={shows} /> : <p className="muted">Loading…</p>}
    </>
  );
}

function Panels({ data, shows }: { data: Overview; shows: (p: Panel) => boolean }) {
  return (
    <>
      {shows("control") && <ControlStrip data={data} />}
      <div className="mt-companion-grid">
        <LiveProjection races={data.races} />
        {(shows("calls") || shows("schedule")) && (
          <div className="mt-companion-side">
            {shows("calls") && <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office="all" />}
            {shows("schedule") && <PollSchedule races={data.races} />}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * On a companion screen, over this tab's own page: the live projection of each chamber, and what the main screen can't
 * show of latest calls, poll closings or who controls each chamber. Big moments pop up here instead of on the main screen. A companion runs
 * the main screen's mock night, if any, so the two show the same night. "Use this tab normally" leaves the setup.
 */
export function Companion() {
  const { role, hidden, mainMock } = useScreens();
  const companion = role === "companion";
  useEffect(() => {
    if (companion) adoptMock(mainMock);
  }, [companion, mainMock]);
  const body = useSyncExternalStore(noSubscribe, () => document.body, () => null);
  if (!companion || !body) return null;
  return createPortal(
    <div className="mt mt-companion" role="region" aria-label="Companion screen">
      <Body hidden={hidden} />
    </div>,
    body,
  );
}
