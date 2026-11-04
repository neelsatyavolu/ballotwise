"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { momentKey, moments, type Moment } from "@/lib/midterms/moments";
import { stampTime } from "@/lib/midterms/polls";
import type { Overview } from "@/lib/midterms/view";
import { useStored } from "./seen";
import { useScreens } from "./useScreens";

const KEY = "mt-moments";
/** Other moments listed under the lead one before "and N more". */
const ALSO = 4;
/** How long a pop-up stays before closing by itself, and then the rest before the next. */
const SHOW_MS = 5_000;
/** Tabs tell each other what "Got it" closed, so it closes on every screen in this browser. */
const CHANNEL = "mt-moments";

const newestFirst = (a: Moment, b: Moment) => b.at - a.at;

/**
 * A pop-up in the middle of the screen when a toss-up or lean seat changes party (moments.ts). Moments already there
 * when the page opens never pop, and several arriving together share one pop-up. It pops on every screen showing
 * results (the main screen, the companion, the walls); only the page under the companion screen stays quiet, since
 * the companion covers it. It closes by itself after SHOW_MS, with as long a rest before the next so a wave of flips
 * can't keep a screen covered, and "Got it" closes it on every screen. The switch it renders turns pop-ups off and on.
 */
/** `inCompanion` marks the companion screen's own copy. */
export function MomentPopup({ data, inCompanion = false }: { data: Overview; inCompanion?: boolean }) {
  const [stored, setStored] = useStored(KEY);
  const off = stored === "off";
  const all = useMemo(() => moments(data), [data]);
  // The page under the companion screen is covered by it, which pops its own: this one only learns what's known.
  const role = useScreens().role;
  const covered = role === "companion" && !inCompanion;
  // `from` is the list last learned from: the first pass only learns, later ones queue what's new.
  const [state, setState] = useState<{ from: Moment[] | null; known: ReadonlySet<string>; open: Moment[] }>({ from: null, known: new Set(), open: [] });
  if (state.from !== all) {
    const fresh = state.from && !off && !covered ? all.filter((m) => !state.known.has(m.key)) : [];
    const known = new Set([...state.known, ...all.map((m) => m.key), ...(data.callEvents ?? []).map(momentKey)]);
    setState({ from: all, known, open: fresh.length ? [...state.open, ...fresh].sort(newestFirst) : state.open });
  }
  const dialog = useRef<HTMLDialogElement>(null);
  const gotIt = useRef<HTMLButtonElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const [resting, setResting] = useState(false);
  const shown = !off && !covered && !resting && state.open.length > 0;
  // "Got it" on another screen closes the same moments here.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent<{ dismiss?: string[] }>) => {
      const gone = new Set(e.data?.dismiss ?? []);
      setState((s) => ({ ...s, open: s.open.filter((m) => !gone.has(m.key)) }));
    };
    channel.current = ch;
    return () => ch.close();
  }, []);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => {
      setResting(true);
      dialog.current?.close();
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [shown]);
  useEffect(() => {
    if (!resting) return;
    const t = setTimeout(() => setResting(false), SHOW_MS);
    return () => clearTimeout(t);
  }, [resting]);
  useEffect(() => {
    const d = dialog.current;
    if (shown && d && !d.open) {
      d.showModal();
      // "Got it", not the race link, so Enter or Space dismisses.
      gotIt.current?.focus();
    }
    if (!shown && d?.open) d.close();
  }, [shown]);
  const dismiss = () => setState((s) => ({ ...s, open: [] }));
  const gotItEverywhere = () => {
    channel.current?.postMessage({ dismiss: state.open.map((m) => m.key) });
    dialog.current?.close();
  };

  const [top, ...rest] = state.open;
  return (
    <>
      <button type="button" className={`mt-bell${off ? "" : " on"}`} aria-pressed={!off} onClick={() => setStored(off ? null : "off")} title={off ? "Pop up toss-up and lean seats changing party" : "Toss-up and lean seats changing party pop up in the middle of the screen. Tap to stop them."}>
        {off ? "Pop-ups off" : "Pop-ups on"}
      </button>
      <dialog ref={dialog} className="mt-moment" aria-labelledby="mt-moment-title" onClose={dismiss} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
        {top && (
          <>
            <p className="mt-moment-kicker small">
              <b className={top.side ? `p-${top.side}` : "warn"}>{top.kicker}</b>
              <time className="muted" dateTime={new Date(top.at).toISOString()}>{stampTime(top.at)}</time>
            </p>
            <h2 id="mt-moment-title">{top.title}</h2>
            <p>{top.body}</p>
            {rest.length > 0 && (
              <ul className="mt-moment-also small">
                {rest.slice(0, ALSO).map((m) => (
                  <li key={m.key}>
                    <b className={m.side ? `p-${m.side}` : "warn"}>{m.kicker}</b> <Link href={m.href}>{m.title}</Link>
                  </li>
                ))}
                {rest.length > ALSO && <li className="muted">and {rest.length - ALSO} more in Latest calls</li>}
              </ul>
            )}
            <div className="mt-moment-actions">
              <Link href={top.href} className="btn">See the race</Link>
              <button ref={gotIt} type="button" className="btn secondary" onClick={gotItEverywhere}>Got it</button>
              <button type="button" className="mt-linkish small" onClick={() => setStored("off")}>Stop pop-ups</button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
