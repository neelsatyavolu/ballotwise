"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { callKey, moments, type Moment } from "@/lib/midterms/moments";
import { stampET } from "@/lib/midterms/polls";
import type { Overview } from "@/lib/midterms/view";
import { useStored } from "./seen";
import { useScreens } from "./useScreens";

const KEY = "mt-moments";
/** Other moments listed under the lead one before "and N more". */
const ALSO = 4;
/** How long the main screen's corner note stays when the pop-up itself opens on the companion screen. */
const NOTE_MS = 8_000;

const order = (a: Moment, b: Moment) => a.rank - b.rank || b.at - a.at;

/**
 * A pop-up in the middle of the screen when something big happens: a chamber decided, a call changed or withdrawn, a
 * seat changing party, a starred race or a toss-up called. Moments already there when the page opens never pop, and
 * several arriving together share one pop-up. The switch it renders turns pop-ups off and back on.
 */
/** `inCompanion` marks the companion screen's own copy; the page under a companion stays quiet so only one pops. */
export function MomentPopup({ data, starred, inCompanion = false }: { data: Overview; starred: readonly number[] | null; inCompanion?: boolean }) {
  const [stored, setStored] = useStored(KEY);
  const off = stored === "off";
  const all = useMemo(() => moments(data, new Set(starred ?? [])), [data, starred]);
  // `from` is the list last learned from: the first pass only learns, later ones queue what's new. Every call event
  // counts as known once seen, so stars loading after the page opens don't turn old calls into new moments.
  const [state, setState] = useState<{ from: Moment[] | null; known: ReadonlySet<string>; open: Moment[] }>({ from: null, known: new Set(), open: [] });
  if (state.from !== all) {
    const fresh = state.from && !off ? all.filter((m) => !state.known.has(m.key)) : [];
    const known = new Set([...state.known, ...all.map((m) => m.key), ...(data.callEvents ?? []).map(callKey)]);
    setState({ from: all, known, open: fresh.length ? [...state.open, ...fresh].sort(order) : state.open });
  }
  const dialog = useRef<HTMLDialogElement>(null);
  const gotIt = useRef<HTMLButtonElement>(null);
  // With a companion screen open, the pop-up opens there; this main screen only notes it in a corner for a moment.
  const role = useScreens().role;
  const elsewhere = role === "main" || (role === "companion" && !inCompanion);
  const shown = !off && !elsewhere && state.open.length > 0;
  const noted = !off && role === "main" && state.open.length > 0;
  // Moments shown elsewhere clear after the note's time (at once, under a companion), so they don't pile up here.
  const pending = elsewhere && state.open.length > 0;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setState((s) => ({ ...s, open: [] })), noted ? NOTE_MS : 0);
    return () => clearTimeout(t);
  }, [pending, noted, state.open]);
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
      {noted && top && (
        <p className="mt-moment-note small" role="status">
          <b className={top.side ? `p-${top.side}` : "warn"}>{top.kicker}</b> {top.title}
          {rest.length > 0 && <span className="muted"> +{rest.length} more</span>}
          <span className="muted"> · on your other screen</span>
        </p>
      )}
      <dialog ref={dialog} className="mt-moment" aria-labelledby="mt-moment-title" onClose={dismiss} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
        {top && (
          <>
            <p className="mt-moment-kicker small">
              <b className={top.side ? `p-${top.side}` : "warn"}>{top.kicker}</b>
              <time className="muted" dateTime={new Date(top.at).toISOString()}>{stampET(top.at)}</time>
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
