"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
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

/** The most race cards the companion lays out; a big screen fits a few dozen, never the House's 435. */
const MAX_CARDS = 60;
const OFFICES = new Set(["senate", "house", "governor"]);

/**
 * Hides every card from the first one that runs past the bottom of the list, so the companion fills its window
 * without scrolling. Hiding from there on, not each card that's cut off, keeps the cards before it in place.
 */
function fitCards(ul: HTMLUListElement | null) {
  if (!ul) return;
  const cards = [...ul.children] as HTMLElement[];
  cards.forEach((c) => (c.hidden = false));
  const bottom = ul.getBoundingClientRect().bottom;
  const first = cards.findIndex((c) => c.getBoundingClientRect().bottom > bottom + 1);
  // The first card always shows, even on a window too short for it.
  if (first >= 0) cards.slice(Math.max(first, 1)).forEach((c) => (c.hidden = true));
}

/** Fits the list's cards after every render (results change their heights) and whenever the list changes size. */
function useFitCards(list: RefObject<HTMLUListElement | null>, shown: boolean) {
  useLayoutEffect(() => fitCards(list.current));
  useEffect(() => {
    const ul = list.current;
    if (!shown || !ul) return;
    const watch = new ResizeObserver(() => fitCards(ul));
    watch.observe(ul);
    return () => watch.disconnect();
  }, [list, shown]);
}

/**
 * The races the main screen has no card for, closest first, as many as fit: the toss-ups it can't fit come first, then
 * the next closest Senate, House and governor races, so the companion fills its screen even when little is hidden.
 */
function Closest({ data, stars, seen }: { data: Overview; stars: ReturnType<typeof useStars>; seen: readonly number[] }) {
  const races = useMemo(() => data.races.filter((r) => OFFICES.has(r.office) && !seen.includes(r.id)).sort(closestFirst).slice(0, MAX_CARDS), [data, seen]);
  const tossups = races.some((r) => r.rating === "tossup");
  const list = useRef<HTMLUListElement>(null);
  useFitCards(list, races.length > 0);
  if (!races.length) return null;
  return (
    <section className="mt-companion-tossups" aria-label="Closest races not on your main screen">
      <div className="mt-section-head tight">
        <h2>Not on your main screen</h2>
        <span className="muted small">{tossups ? "Toss-ups first, then the next closest" : "The next closest races"}</span>
      </div>
      <ul ref={list} className="mt-grid mt-sbs-cards">
        {races.map((r) => (
          <RaceCard key={r.id} race={r} starred={stars.ids ? stars.ids.includes(r.id) : null} onStar={stars.toggle} limit={2} />
        ))}
      </ul>
    </section>
  );
}

/** Mounted only on a companion, so other tabs don't fetch or load stars for it. */
function Body({ hidden, seen }: { hidden: readonly Panel[]; seen: readonly number[] }) {
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
      {data ? <Panels data={data} seen={seen} stars={stars} shows={shows} /> : <p className="muted">Loading…</p>}
    </>
  );
}

function Panels({ data, seen, stars, shows }: { data: Overview; seen: readonly number[]; stars: ReturnType<typeof useStars>; shows: (p: Panel) => boolean }) {
  return (
    <>
      {shows("control") && <ControlStrip data={data} />}
      <div className="mt-companion-grid">
        <Closest data={data} stars={stars} seen={seen} />
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
 * On a companion screen, what the main screen can't show, over this tab's own page: the closest races it has no card
 * for, latest calls, poll closings or who controls each chamber. Big moments pop up here instead of on the main screen. A companion runs
 * the main screen's mock night, if any, so the two show the same night. "Use this tab normally" leaves the setup.
 */
export function Companion() {
  const { role, hidden, seen, mainMock } = useScreens();
  const companion = role === "companion";
  useEffect(() => {
    if (companion) adoptMock(mainMock);
  }, [companion, mainMock]);
  const body = useSyncExternalStore(noSubscribe, () => document.body, () => null);
  if (!companion || !body) return null;
  return createPortal(
    <div className="mt mt-companion" role="region" aria-label="Companion screen">
      <Body hidden={hidden} seen={seen} />
    </div>,
    body,
  );
}
