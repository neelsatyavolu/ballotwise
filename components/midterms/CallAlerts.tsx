"use client";

import { useEffect, useRef, useState } from "react";
import type { CallEvent, RaceSummary } from "@/lib/midterms/view";
import { momentKey } from "@/lib/midterms/moments";
import { shortLabel } from "./PollClose";
import { readStored, useStored, writeStored } from "./seen";

const KEY = "mt-call-alerts";
/** The switch for the corner pop-ups every page shows on a call (CallPopups). */
export const POPUPS_KEY = "mt-call-popups";

/** Whether this browser asked for call alerts and allows them. */
export function notificationsOn(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted" && readStored(KEY) === "on";
}

/** Asks for notification permission and turns call alerts on; false when the browser refuses. */
export async function turnOnNotifications(): Promise<boolean> {
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission === "granted") writeStored(KEY, "on");
  return permission === "granted";
}

/** A short two-note chime, made on the spot so there's no sound file to load. */
export function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // No audio (or blocked until a tap): the notification alone will do.
  }
}

function describe(e: CallEvent, r: RaceSummary | undefined): { title: string; body: string } {
  const where = r ? shortLabel(r) : "A race";
  if (e.kind === "withdrawal") return { title: `Call withdrawn: ${where}`, body: `The call for ${e.previous ?? "the leader"} was withdrawn.` };
  if (e.kind === "change") return { title: `Call changed: ${where}`, body: `Now ${e.winner}${e.previous ? `, was ${e.previous}` : ""}.` };
  return { title: `Called: ${where}`, body: `${e.winner ?? "A winner"}${e.party ? ` (${e.party})` : ""}` };
}

/**
 * The switch for call alerts: a browser notification and a short chime for calls, changed calls and withdrawals.
 * Public calls are announced on every page by CallPopups; this sends only a Decision Desk HQ viewer's own calls
 * (`currentOnly`), which that page alone knows. Events already on screen when alerts are turned on don't alert.
 * While the corner pop-ups are switched off, it also offers to turn them back on.
 */
export function CallAlerts({ events, races, currentOnly = false }: { events: readonly CallEvent[]; races: readonly RaceSummary[]; currentOnly?: boolean }) {
  const [stored, setStored] = useStored(KEY);
  const [popups, setPopups] = useStored(POPUPS_KEY);
  const supported = typeof window !== "undefined" && "Notification" in window;
  const on = stored === "on" && supported && Notification.permission === "granted";
  const [denied, setDenied] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!on || !currentOnly) {
      seen.current = null;
      return;
    }
    // The first pass after turning on only learns what's already there.
    if (!seen.current) {
      seen.current = new Set(events.map(momentKey));
      return;
    }
    const fresh = events.filter((e) => !seen.current!.has(momentKey(e)));
    if (!fresh.length) return;
    for (const e of fresh) seen.current.add(momentKey(e));
    const byId = new Map(races.map((r) => [r.id, r]));
    for (const e of fresh.slice(0, 5)) {
      const { title, body } = describe(e, byId.get(e.raceId));
      try {
        new Notification(title, { body, tag: `mt-${momentKey(e)}` });
      } catch {
        // Some browsers only allow notifications from a service worker; the chime still sounds.
      }
    }
    chime();
  }, [on, currentOnly, events, races]);

  const unmute = popups === "off" && (
    <button type="button" className="mt-bell" onClick={() => setPopups(null)} title="New calls pop up in the corner of every page. Tap to turn them back on.">
      Call pop-ups off
    </button>
  );
  if (!supported) return unmute || null;
  const toggle = async () => {
    if (on) return setStored("off");
    setDenied(!(await turnOnNotifications()));
  };
  return (
    <>
    {unmute}
    <button
      type="button"
      className={`mt-bell${on ? " on" : ""}`}
      aria-pressed={on}
      onClick={() => void toggle()}
      title={denied ? "Notifications are blocked for this site in your browser settings" : currentOnly ? on ? "Alerts on for new and changed DDHQ calls. Tap to turn off." : "Alert me to new and changed DDHQ calls" : on ? "Alerts on for new, changed and withdrawn calls. Tap to turn off." : "Alert me when a race is called, a call changes or is withdrawn"}
    >
      {denied ? "Alerts blocked" : on ? "Alerts on" : "Alerts off"}
    </button>
    </>
  );
}
