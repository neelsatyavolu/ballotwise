"use client";

import { useSyncExternalStore } from "react";
import { clockNow } from "@/lib/midterms/clock";
import { electionModeDefault } from "@/lib/midterms/polls";
import { useClock } from "./hooks";

const CHANGED = "mt-election-mode";

// A choice made before Nov 3 doesn't carry into election day, so the switch turns on by itself that morning.
const storageKey = (now: number) => `mt-election-mode:${electionModeDefault(now) ? "night" : "before"}`;

function readChoice(): boolean | null {
  try {
    const v = localStorage.getItem(storageKey(clockNow()));
    return v === "on" ? true : v === "off" ? false : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/**
 * Whether election mode is on: the viewer's own choice, or on by default from Nov 3. The clock ticks each minute
 * so a tab left open overnight switches on by itself that morning (the choice read then is election day's).
 */
export function useElectionMode() {
  const now = useClock(60_000);
  const choice = useSyncExternalStore(subscribe, readChoice, () => null);
  const on = choice ?? electionModeDefault(now);
  const set = (next: boolean) => {
    try {
      localStorage.setItem(storageKey(clockNow()), next ? "on" : "off");
    } catch {
      // Private windows can refuse storage; the switch then lasts only until reload.
    }
    window.dispatchEvent(new Event(CHANGED));
  };
  return { on, set };
}

export function ElectionToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="mt-el-switch" onClick={() => onChange(!on)}>
      <span className="mt-el-knob" aria-hidden />
      Election mode
    </button>
  );
}
