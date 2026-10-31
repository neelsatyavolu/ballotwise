"use client";
// This tab's side of the two-screen setup (see lib/midterms/screens.ts): it reports what it shows to the other tracker
// tabs in this browser over a BroadcastChannel and works out whether it's the main screen, a companion or solo.

import { useSyncExternalStore } from "react";
import { readMock, type Mock } from "@/lib/midterms/clock";
import { EXPIRE_MS, hiddenOn, PANELS, roleOf, type Panel, type Role, type Screen } from "@/lib/midterms/screens";

const CHANNEL = "mt-screens";
const BEAT_MS = 2_000;
const SOLO_KEY = "mt-solo";

/** This tab's role; for a companion, what to show and the main screen's mock night (null when it runs none). */
export type Screens = { role: Role; hidden: readonly Panel[]; mainMock: Mock | null };
const SOLO: Screens = { role: "solo", hidden: [], mainMock: null };

const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
const startedAt = Date.now();
const others = new Map<string, Screen>();
const listeners = new Set<() => void>();
let snapshot: Screens = SOLO;
let channel: BroadcastChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function isSolo(): boolean {
  try {
    return sessionStorage.getItem(SOLO_KEY) === "1";
  } catch {
    return false;
  }
}

/** The panels this tab shows right now: those laid out on the page (not hidden by a media query or a toggle). */
function shownPanels(): Panel[] {
  const found = new Set<Panel>();
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((el) => {
    const p = el.dataset.panel as Panel;
    if (PANELS.includes(p) && !el.closest(".mt-companion") && el.getClientRects().length > 0) found.add(p);
  });
  return [...found];
}

function self(): Screen {
  return { id, startedAt, at: Date.now(), visible: document.visibilityState === "visible", area: window.innerWidth * window.innerHeight, panels: shownPanels(), solo: isSolo(), mock: readMock() };
}

function update(me: Screen) {
  const now = Date.now();
  for (const [key, s] of others) if (now - s.at >= EXPIRE_MS) others.delete(key);
  const { role, main } = roleOf(me, [...others.values()], now);
  const next: Screens = { role, hidden: main ? hiddenOn(main) : [], mainMock: main?.mock ?? null };
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

function beat() {
  const me = self();
  channel?.postMessage({ type: "screen", screen: me });
  update(me);
}

function onMessage(e: MessageEvent) {
  const msg = e.data as { type: "screen"; screen: Screen } | { type: "bye"; id: string } | { type: "hello" };
  if (msg.type === "screen") others.set(msg.screen.id, msg.screen);
  else if (msg.type === "bye") others.delete(msg.id);
  // A new tab asks everyone to report at once, so it doesn't wait a beat to learn its role.
  if (msg.type === "hello") beat();
  else update(self());
}

const onVisibility = () => beat();
const onHide = () => channel?.postMessage({ type: "bye", id });

function start() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener("message", onMessage);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onVisibility);
  window.addEventListener("pagehide", onHide);
  timer = setInterval(beat, BEAT_MS);
  channel.postMessage({ type: "hello" });
  beat();
}

function stop() {
  onHide();
  channel?.close();
  channel = null;
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("resize", onVisibility);
  window.removeEventListener("pagehide", onHide);
  others.clear();
  snapshot = SOLO;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  start();
  return () => {
    listeners.delete(onChange);
    if (!listeners.size) stop();
  };
}

/** Whether this tab is the main screen, a companion (with what it should show) or on its own. */
export function useScreens(): Screens {
  return useSyncExternalStore(subscribe, () => snapshot, () => SOLO);
}

/** Keep this tab out of the two-screen setup (or let it back in), effective at once. */
export function setSolo(solo: boolean) {
  try {
    if (solo) sessionStorage.setItem(SOLO_KEY, "1");
    else sessionStorage.removeItem(SOLO_KEY);
  } catch {
    // Storage off: the choice can't be kept.
  }
  beat();
}
