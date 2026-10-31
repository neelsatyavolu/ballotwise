"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { adoptMock } from "@/lib/midterms/clock";
import { closestFirst } from "@/lib/midterms/explore";
import type { Panel } from "@/lib/midterms/screens";
import type { Overview } from "@/lib/midterms/view";
import { CallsFeed } from "./CallsFeed";
import { ControlStrip } from "./ControlStrip";
import { useLive, useStars } from "./hooks";
import { MomentPopup } from "./MomentPopup";
import { PollSchedule } from "./PollClose";
import { RaceCard } from "./RaceCard";
import { setSolo, useScreens } from "./useScreens";

const noSubscribe = () => () => {};

function Tossups({ data, stars }: { data: Overview; stars: ReturnType<typeof useStars> }) {
  const races = useMemo(() => data.races.filter((r) => r.rating === "tossup" && (r.office === "senate" || r.office === "house")).sort(closestFirst), [data]);
  return (
    <section className="mt-companion-tossups" aria-label="Toss-up races">
      <div className="mt-section-head tight">
        <h2>Toss-ups</h2>
        <span className="muted small">{races.length}</span>
      </div>
      <ul className="mt-grid mt-sbs-cards">
        {races.map((r) => (
          <RaceCard key={r.id} race={r} starred={stars.ids ? stars.ids.includes(r.id) : null} onStar={stars.toggle} limit={2} />
        ))}
      </ul>
    </section>
  );
}

/** Mounted only on a companion, so other tabs don't fetch or load stars for it. */
function Body({ hidden }: { hidden: readonly Panel[] }) {
  const data = useLive<Overview>("/api/midterms").data;
  const stars = useStars();
  const shows = (p: Panel) => hidden.includes(p);
  return (
    <>
      <header className="mt-companion-bar">
        <b>Companion screen</b>
        <span className="muted small">Showing what your main screen doesn&apos;t.</span>
        {data && <MomentPopup data={data} starred={stars.ids} inCompanion />}
        <button type="button" className="mt-el-quiet small" onClick={() => setSolo(true)}>Use this tab normally</button>
      </header>
      {data ? <Panels data={data} hidden={hidden} stars={stars} shows={shows} /> : <p className="muted">Loading…</p>}
    </>
  );
}

function Panels({ data, hidden, stars, shows }: { data: Overview; hidden: readonly Panel[]; stars: ReturnType<typeof useStars>; shows: (p: Panel) => boolean }) {
  return (
    <>
      {shows("control") && <ControlStrip data={data} />}
      <div className="mt-companion-grid">
        {shows("tossups") && <Tossups data={data} stars={stars} />}
        {(shows("calls") || shows("schedule")) && (
          <div className="mt-companion-side">
            {shows("calls") && <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office="all" />}
            {shows("schedule") && <PollSchedule races={data.races} />}
          </div>
        )}
      </div>
      {!hidden.length && <p className="muted">Your main screen already shows everything. Big moments will pop up here.</p>}
    </>
  );
}

/**
 * On a companion screen, the panels the main screen can't show, over this tab's own page: toss-ups, latest calls,
 * poll closings or who controls each chamber. Big moments pop up here instead of on the main screen. A companion runs
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
