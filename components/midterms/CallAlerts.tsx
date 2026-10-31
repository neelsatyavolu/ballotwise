"use client";

import { useEffect, useRef, useState } from "react";
import type { CallEvent, RaceSummary } from "@/lib/midterms/view";
import { shortLabel } from "./PollClose";
import { useStored } from "./seen";

const KEY = "mt-call-alerts";

/** A short two-note chime, made on the spot so there's no sound file to load. */
function chime() {
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
 * Opt-in alerts for calls, changed calls and withdrawals: a browser notification and a short chime, once per event.
 * Vote updates never alert. Events already on screen when alerts are turned on (or the page opens) don't alert.
 */
export function CallAlerts({ events, races }: { events: readonly CallEvent[]; races: readonly RaceSummary[] }) {
  const [stored, setStored] = useStored(KEY);
  const supported = typeof window !== "undefined" && "Notification" in window;
  const on = stored === "on" && supported && Notification.permission === "granted";
  const [denied, setDenied] = useState(false);
  const seen = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!on) {
      seen.current = null;
      return;
    }
    // The first pass after turning on only learns what's already there.
    if (!seen.current) {
      seen.current = new Set(events.map((e) => e.id));
      return;
    }
    const fresh = events.filter((e) => !seen.current!.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seen.current.add(e.id);
    const byId = new Map(races.map((r) => [r.id, r]));
    for (const e of fresh.slice(0, 5)) {
      const { title, body } = describe(e, byId.get(e.raceId));
      try {
        new Notification(title, { body, tag: `mt-call-${e.id}` });
      } catch {
        // Some browsers only allow notifications from a service worker; the chime still sounds.
      }
    }
    chime();
  }, [on, events, races]);

  if (!supported) return null;
  const toggle = async () => {
    if (on) return setStored("off");
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setDenied(permission !== "granted");
    if (permission === "granted") setStored("on");
  };
  return (
    <button
      type="button"
      className={`mt-bell${on ? " on" : ""}`}
      aria-pressed={on}
      onClick={() => void toggle()}
      title={denied ? "Notifications are blocked for this site in your browser settings" : on ? "Alerts on for new, changed and withdrawn calls. Tap to turn off." : "Alert me when a race is called, a call changes or is withdrawn"}
    >
      {denied ? "Alerts blocked" : on ? "Alerts on" : "Alerts off"}
    </button>
  );
}
