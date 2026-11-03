"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { callKey, moments, type Moment } from "@/lib/midterms/moments";
import { stampTime } from "@/lib/midterms/polls";
import type { Overview } from "@/lib/midterms/view";
import { useStored } from "./seen";
import { useScreens } from "./useScreens";

const KEY = "mt-moments";
/** Other moments listed under the lead one before "and N more". */
const ALSO = 4;

const order = (a: Moment, b: Moment) => a.rank - b.rank || b.at - a.at;

/**
 * A pop-up in the middle of the screen when something big happens: a chamber decided, a call changed or withdrawn, a
 * seat changing party, a starred race, a toss-up or a close lean called. Moments already there when the page opens
 * never pop, and several arriving together share one pop-up. It pops on every screen showing results (the main
 * screen, the companion, the walls); only the page under the companion screen stays quiet, since the companion covers
 * it. The switch it renders turns pop-ups off and back on. `closeAfterMs` closes it by itself (the walls, where
 * nobody clicks), with as long a rest before the next.
 */
/** `inCompanion` marks the companion screen's own copy. */
export function MomentPopup({ data, starred, inCompanion = false, closeAfterMs }: { data: Overview; starred: readonly number[] | null; inCompanion?: boolean; closeAfterMs?: number }) {
  const [stored, setStored] = useStored(KEY);
  const off = stored === "off";
  const all = useMemo(() => moments(data, new Set(starred ?? [])), [data, starred]);
  // The page under the companion screen is covered by it, which pops its own: this one only learns what's known.
  const role = useScreens().role;
  const covered = role === "companion" && !inCompanion;
  // `from` is the list last learned from: the first pass only learns, later ones queue what's new. Every call event
  // counts as known once seen, so stars loading after the page opens don't turn old calls into new moments.
  const [state, setState] = useState<{ from: Moment[] | null; known: ReadonlySet<string>; open: Moment[] }>({ from: null, known: new Set(), open: [] });
  if (state.from !== all) {
    const fresh = state.from && !off && !covered ? all.filter((m) => !state.known.has(m.key)) : [];
    const known = new Set([...state.known, ...all.map((m) => m.key), ...(data.callEvents ?? []).map(callKey)]);
    setState({ from: all, known, open: fresh.length ? [...state.open, ...fresh].sort(order) : state.open });
  }
  const dialog = useRef<HTMLDialogElement>(null);
  const gotIt = useRef<HTMLButtonElement>(null);
  // With `closeAfterMs`, a pop-up closes that long after opening, then the screen rests as long before the next, so a
  // wave of calls can't keep it covered; calls arriving meanwhile wait and pop together.
  const [resting, setResting] = useState(false);
  const shown = !off && !covered && !resting && state.open.length > 0;
  useEffect(() => {
    if (!shown || !closeAfterMs) return;
    const t = setTimeout(() => {
      setResting(true);
      dialog.current?.close();
    }, closeAfterMs);
    return () => clearTimeout(t);
  }, [shown, closeAfterMs]);
  useEffect(() => {
    if (!resting) return;
    const t = setTimeout(() => setResting(false), closeAfterMs);
    return () => clearTimeout(t);
  }, [resting, closeAfterMs]);
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

  const [top, ...rest] = state.open;
  return (
    <>
      <button type="button" className={`mt-bell${off ? "" : " on"}`} aria-pressed={!off} onClick={() => setStored(off ? null : "off")} title={off ? "Pop up big moments: control, flips, changed calls, your races" : "Big moments pop up in the middle of the screen. Tap to stop them."}>
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
                    <b className={m.side ? `p-${m.side}` : "warn"}>{m.kicker}</b> {m.href ? <Link href={m.href}>{m.title}</Link> : m.title}
                  </li>
                ))}
                {rest.length > ALSO && <li className="muted">and {rest.length - ALSO} more in Latest calls</li>}
              </ul>
            )}
            <div className="mt-moment-actions">
              {top.href && <Link href={top.href} className="btn">See the race</Link>}
              <button ref={gotIt} type="button" className="btn secondary" onClick={() => dialog.current?.close()}>Got it</button>
              <button type="button" className="mt-linkish small" onClick={() => setStored("off")}>Stop pop-ups</button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
