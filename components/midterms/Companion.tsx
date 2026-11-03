"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { adoptMock } from "@/lib/midterms/clock";
import type { Panel } from "@/lib/midterms/screens";
import type { Overview } from "@/lib/midterms/view";
import { CallsFeed } from "./CallsFeed";
import { CompanionNearYou } from "./CompanionNearYou";
import { ControlStrip } from "./ControlStrip";
import { LiveProjection } from "./LiveProjection";
import { useLive, useStars } from "./hooks";
import { MomentPopup } from "./MomentPopup";
import { PollSchedule } from "./PollClose";
import { setSolo, useScreens } from "./useScreens";

const noSubscribe = () => () => {};

/** What the companion's main area shows: the live projection or the races on the voter's ballot. Kept in this browser. */
type View = "projection" | "near";
const VIEW_KEY = "mt-companion-view";

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "near" ? "near" : "projection";
  } catch {
    return "projection";
  }
}

/** The companion's view, and a setter that remembers it for next time. */
function useView(): [View, (v: View) => void] {
  // The companion only draws in the browser (see Companion), so storage can be read on first render.
  const [view, setView] = useState<View>(readView);
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Storage off: the choice lasts until the tab closes.
    }
  };
  return [view, choose];
}

/** Mounted only on a companion, so other tabs don't fetch or load stars for it. */
function Body({ hidden }: { hidden: readonly Panel[] }) {
  const data = useLive<Overview>("/api/midterms").data;
  const stars = useStars();
  const shows = (p: Panel) => hidden.includes(p);
  const [view, setView] = useView();
  return (
    <>
      <header className="mt-companion-bar">
        <b>Companion screen</b>
        <div className="mt-seg" role="group" aria-label="Companion shows">
          <button type="button" aria-pressed={view === "projection"} onClick={() => setView("projection")}>
            Live projection
          </button>
          <button type="button" aria-pressed={view === "near"} onClick={() => setView("near")}>
            Near you
          </button>
        </div>
        {data && <MomentPopup data={data} starred={stars.ids} inCompanion />}
        <button type="button" className="mt-el-quiet small" onClick={() => setSolo(true)}>Use this tab normally</button>
      </header>
      {data ? <Panels data={data} shows={shows} view={view} /> : <p className="muted">Loading…</p>}
    </>
  );
}

function Panels({ data, shows, view }: { data: Overview; shows: (p: Panel) => boolean; view: View }) {
  return (
    <>
      {shows("control") && <ControlStrip data={data} />}
      <div className="mt-companion-grid">
        {view === "near" ? <CompanionNearYou races={data.races} /> : <LiveProjection races={data.races} />}
        {(shows("calls") || shows("schedule")) && (
          <div className="mt-companion-side">
            {shows("calls") && <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office="all" fill />}
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
