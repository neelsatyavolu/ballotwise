"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { placeCard, spotlight, type Box } from "@/lib/midterms/tour";

type Step = { target: string; title: string; body: string };

/** Each step marks one part of the overview; a step whose part isn't on screen (another tab, a phone layout) is skipped. */
const STEPS: Step[] = [
  {
    target: "[data-tour=balance]",
    title: "Who's winning control",
    body: "Seats each party holds, counting the ones not up this year, against what it takes to control the Senate and House. The bars fill in as races are called.",
  },
  {
    target: "[data-tour=map]",
    title: "The map",
    body: "Before votes come in, shading shows the forecast; once they do, who's ahead. Stripes mark a seat projected to change party. Hover a state for details, tap it to open the race, and switch between Senate, Governor and House above.",
  },
  {
    target: "[data-tour=races]",
    title: "The races to watch",
    body: "The closest contests first, with toss-ups marked in yellow. Tap a race for county results, polls and prediction markets, or the star to follow it.",
  },
  {
    target: "[data-tour=tabs]",
    title: "Your races and dashboards",
    body: "Starred races collect under My races. My dashboards builds boards of your own, and All races lists every race on the ballot, ballot measures included.",
  },
  {
    target: ".mt-hero .mt-el-switch",
    title: "On election night",
    body: "Switch on election mode for the live view: race calls as they happen, the next polls to close, and the races still counting.",
  },
];

const DONE_KEY = "mt-tour-done";
const CHANGED = "mt-tour";
// Where storage is off, the tour is remembered for this page load only.
let doneInMemory = false;

function readDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return doneInMemory;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function setDone(done: boolean) {
  doneInMemory = done;
  try {
    if (done) localStorage.setItem(DONE_KEY, "1");
    else localStorage.removeItem(DONE_KEY);
  } catch {
    // Storage is off; the in-memory flag stands in.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Starts the tour over, for the overview's "Take the tour" link. */
export const replayTour = () => setDone(false);

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/**
 * A first-visit tour of the overview: a highlight on one part of the page at a time, with a card saying what it is.
 * Shown once per browser; skipping or finishing it, or pressing Escape, puts it away. The page stays usable under it.
 */
export function Tour() {
  // On the server and while hydrating it counts as done, so it only ever renders in the browser.
  const done = useSyncExternalStore(subscribe, readDone, () => true);
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 200 });
  const card = useRef<HTMLDivElement>(null);
  const finish = useCallback(() => {
    setDone(true);
    setStep(0);
    setTarget(null);
  }, []);

  // Each step scrolls its part of the page into view, and skips ahead past one that isn't there.
  useLayoutEffect(() => {
    if (done) return;
    const show = () => {
      const el = document.querySelector(STEPS[step].target);
      if (!el) return step + 1 < STEPS.length ? setStep(step + 1) : finish();
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
      setTarget(boxOf(el));
    };
    show();
  }, [done, step, finish]);

  // The card takes focus once it's on screen, and again each step, so a keyboard or screen reader follows along.
  const shown = target !== null;
  useEffect(() => {
    if (shown) card.current?.focus({ preventScroll: true });
  }, [shown, step]);

  // The highlight follows its part of the page through scrolling and resizing, and the card's height is re-read.
  useEffect(() => {
    if (done) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = document.querySelector(STEPS[step].target);
        if (el) setTarget(boxOf(el));
        const c = card.current;
        if (c) setCardSize((s) => (s.w === c.offsetWidth && s.h === c.offsetHeight ? s : { w: c.offsetWidth, h: c.offsetHeight }));
      });
    };
    // Escape puts the tour away wherever focus is.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    follow();
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
      window.removeEventListener("keydown", onKey);
    };
  }, [done, step, finish]);

  if (done || !target) return null;
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const hole = spotlight(target, viewport);
  const at = placeCard(target, cardSize, viewport);
  const last = step === STEPS.length - 1;

  return (
    <>
      <div className="mt-tour-hole" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} aria-hidden />
      <div
        ref={card}
        className="mt-tour-card"
        style={{ top: at.top, left: at.left }}
        role="dialog"
        aria-labelledby="mt-tour-title"
        aria-describedby="mt-tour-body"
        tabIndex={-1}
      >
        <p className="mt-tour-count">
          {step + 1} of {STEPS.length}
        </p>
        <h2 id="mt-tour-title">{STEPS[step].title}</h2>
        <p id="mt-tour-body">{STEPS[step].body}</p>
        <div className="mt-tour-actions">
          <button type="button" className="btn quiet small" onClick={finish}>
            Skip tour
          </button>
          <span>
            {step > 0 && (
              <button type="button" className="btn secondary small" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button type="button" className="btn small" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? "Done" : "Next"}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
