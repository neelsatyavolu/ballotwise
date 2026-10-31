"use client";
// This tab's side of the two-screen setup (see lib/midterms/screens.ts): it reports what it shows to the other tracker
// tabs in this browser over a BroadcastChannel and works out whether it's the main screen, a companion or solo.

import { useSyncExternalStore } from "react";
import { readMock, type Mock } from "@/lib/midterms/clock";
import { EXPIRE_MS, hiddenOn, PANELS, roleOf, type Panel, type Role, type Screen } from "@/lib/midterms/screens";

const CHANNEL = "mt-screens";
const BEAT_MS = 2_000;
const SOLO_KEY = "mt-solo";

/**
 * This tab's role; for a companion, what to show, the toss-ups already on the main screen and the main screen's mock
 * night (null when it runs none).
 */
export type Screens = { role: Role; hidden: readonly Panel[]; seen: readonly number[]; mainMock: Mock | null };
const SOLO: Screens = { role: "solo", hidden: [], seen: [], mainMock: null };
/** How much of a panel or card has to be in view to count as shown. */
const SHOWN_SHARE = 0.9;
/** A scroll settles for this long before this tab reports what it now shows. */
const SCROLL_SETTLE_MS = 250;

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

/**
 * Whether most of an element is in view: its box cut down to the window and to every box around it that clips or
 * scrolls, so a panel below the fold or a card scrolled out of its list doesn't count.
 */
function inView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  let [top, right, bottom, left] = [Math.max(r.top, 0), Math.min(r.right, window.innerWidth), Math.min(r.bottom, window.innerHeight), Math.max(r.left, 0)];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const c = p.getBoundingClientRect();
    [top, right, bottom, left] = [Math.max(top, c.top), Math.min(right, c.right), Math.min(bottom, c.bottom), Math.max(left, c.left)];
  }
  return Math.max(0, right - left) * Math.max(0, bottom - top) >= r.width * r.height * SHOWN_SHARE;
}

/**
 * What this tab shows right now: the panels in view, and the toss-up cards in view. The toss-ups count as shown only
 * when every card is in view; otherwise a companion shows the ones that aren't.
 */
function shown(): { panels: Panel[]; seen: number[] } {
  const panels = new Set<Panel>();
  const seen = new Set<number>();
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((el) => {
    const p = el.dataset.panel as Panel;
    if (!PANELS.includes(p) || el.closest(".mt-companion")) return;
    if (p !== "tossups") {
      if (inView(el)) panels.add(p);
      return;
    }
    const cards = [...el.querySelectorAll<HTMLElement>("[data-race]")];
    const visible = cards.filter(inView);
    visible.forEach((c) => seen.add(Number(c.dataset.race)));
    if (el.getClientRects().length > 0 && visible.length === cards.length) panels.add(p);
  });
  return { panels: [...panels], seen: [...seen] };
}

function self(): Screen {
  return { id, startedAt, at: Date.now(), visible: document.visibilityState === "visible", area: window.innerWidth * window.innerHeight, ...shown(), solo: isSolo(), mock: readMock() };
}

function update(me: Screen) {
  const now = Date.now();
  for (const [key, s] of others) if (now - s.at >= EXPIRE_MS) others.delete(key);
  const { role, main } = roleOf(me, [...others.values()], now);
  const next: Screens = { role, hidden: main ? hiddenOn(main) : [], seen: main?.seen ?? [], mainMock: main?.mock ?? null };
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
let settle: ReturnType<typeof setTimeout> | null = null;
/** Scrolling the page or a list changes what's in view: report it once the scroll stops. */
const onScroll = () => {
  if (settle) clearTimeout(settle);
  settle = setTimeout(beat, SCROLL_SETTLE_MS);
};

function start() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener("message", onMessage);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onVisibility);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
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
  if (settle) clearTimeout(settle);
  settle = null;
  document.removeEventListener("scroll", onScroll, { capture: true });
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
