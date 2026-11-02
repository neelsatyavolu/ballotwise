"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callAlert, popsUp, type CallAlert } from "@/lib/midterms/callAlert";
import { clockNow, simAt } from "@/lib/midterms/clock";
import { ELECTION_DAY_START } from "@/lib/midterms/polls";
import type { Overview } from "@/lib/midterms/view";
import { chime, notificationsOn, POPUPS_KEY, turnOnNotifications } from "./CallAlerts";
import { pollInterval, useLive } from "./hooks";
import { CloseIcon } from "./icons";
import { useStored } from "./seen";

const PATH = "/api/midterms/calls/latest";
/** Pop-ups on screen at once; more arriving together are counted under them. */
const MAX = 3;
/** How long a pop-up stays, unless the pointer is on the stack. */
const SHOW_MS = 12_000;
/** Most system notifications sent for one batch of calls arriving together. */
const NOTIFY_MAX = 5;
const REQUEST_TIMEOUT_MS = 15_000;

type Shown = CallAlert & { until: number };

/**
 * Every tracker page, whichever tab it's on, pops up a note in the corner when a competitive Senate or House race (see
 * popsUp) is called, its call changes or the call is withdrawn. Calls already made when the page opens don't pop. In a
 * hidden browser tab it keeps checking only when browser alerts are on (the bell in Latest calls, or the button here),
 * and sends a system notification instead.
 */
export function CallPopups() {
  const [muted, setMuted] = useStored(POPUPS_KEY);
  const [alerts] = useStored("mt-call-alerts");
  const [open, setOpen] = useState<Shown[]>([]);
  const [more, setMore] = useState(0);
  const [held, setHeld] = useState(false);
  const known = useRef<Set<number> | null>(null);
  // The polling loop below reads these without restarting.
  const mutedRef = useRef(false);
  const openRef = useRef<Shown[]>([]);
  useEffect(() => {
    mutedRef.current = muted === "off";
    openRef.current = open;
  });

  // Calls already made when the page opens only teach what's known; anything after pops up.
  const take = useCallback((alerts: CallAlert[]) => {
    if (!known.current) {
      known.current = new Set(alerts.map((a) => a.id));
      return;
    }
    const fresh = alerts.filter((a) => !known.current!.has(a.id)).sort((a, b) => b.id - a.id);
    if (!fresh.length) return;
    for (const a of fresh) known.current.add(a.id);
    if (notificationsOn()) {
      if (document.hidden) {
        for (const a of fresh.slice(0, NOTIFY_MAX)) {
          try {
            new Notification(`${a.kicker}: ${a.label}`, { body: a.body, tag: `mt-call-${a.id}` });
          } catch {
            // Some browsers only allow notifications from a service worker; the pop-up still waits on the page.
          }
        }
      }
      chime();
    }
    if (mutedRef.current) return;
    const until = Date.now() + SHOW_MS;
    const next = [...fresh.map((a) => ({ ...a, until })), ...openRef.current];
    openRef.current = next.slice(0, MAX);
    setMore((m) => m + Math.max(0, next.length - MAX));
    setOpen(openRef.current);
  }, []);

  // A mock night or preview simulates its calls in this browser, so they come from the simulated overview; the
  // stored calls the endpoint reports are the real night's.
  const rehearsal = useMemo(() => simAt() !== null, []);
  const simulated = useLive<Overview>(rehearsal ? "/api/midterms" : null, { forecastOnly: true }).catalogData;
  useEffect(() => {
    // The page's first answer is the server's, not yet run through the mock night: learning from it would make every
    // call the night has made so far pop up at once when the simulated one arrives.
    if (!simulated?.simulated) return;
    const byId = new Map(simulated.races.map((r) => [r.id, r]));
    take((simulated.callEvents ?? []).filter((e) => popsUp(e.office, byId.get(e.raceId)?.rating)).map((e) => callAlert(e, byId.get(e.raceId))));
  }, [simulated, take]);

  useEffect(() => {
    if (rehearsal) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let done = false;

    const schedule = () => {
      if (done || timer) return;
      // A hidden tab keeps checking only to send system notifications.
      if (document.hidden && !notificationsOn()) return;
      timer = setTimeout(() => void poll(), pollInterval(clockNow()));
    };

    const poll = async () => {
      timer = null;
      if (clockNow() >= ELECTION_DAY_START) {
        controller = new AbortController();
        try {
          const response = await fetch(PATH, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) });
          const body = (await response.json()) as { alerts?: CallAlert[] };
          if (!done && response.ok && Array.isArray(body.alerts)) take(body.alerts);
        } catch {
          // A missed check is made up by the next one; the calls feed shows its own errors.
        } finally {
          controller = null;
        }
      }
      schedule();
    };

    const onVisibility = () => {
      if (!document.hidden && !timer && !controller) void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rehearsal, take]);

  // Each pop-up leaves after SHOW_MS, held while the pointer or focus is on the stack.
  useEffect(() => {
    if (!open.length || held) return;
    const next = Math.min(...open.map((a) => a.until));
    const t = setTimeout(() => {
      const now = Date.now();
      setOpen((prev) => prev.filter((a) => a.until > now));
      setMore(0);
    }, Math.max(0, next - Date.now()));
    return () => clearTimeout(t);
  }, [open, held]);

  if (muted === "off" || !open.length) return null;
  const dismiss = (id: number) => setOpen((prev) => prev.filter((a) => a.id !== id));
  const hold = () => setHeld(true);
  // Letting go gives the stack a fresh few seconds, so it doesn't vanish the moment the pointer leaves.
  const release = () => {
    setHeld(false);
    setOpen((prev) => prev.map((a) => ({ ...a, until: Math.max(a.until, Date.now() + 4_000) })));
  };
  const canNotify = typeof window !== "undefined" && "Notification" in window && alerts !== "on";

  return (
    <aside className="mt-callpops" aria-label="New race calls" aria-live="polite" onPointerEnter={hold} onPointerLeave={release} onFocus={hold} onBlur={release}>
      {open.map((a) => (
        <div key={a.id} className="mt-callpop">
          <p className="mt-callpop-kicker small">
            <b className={a.side ? `p-${a.side}` : "warn"}>{a.kicker}</b>
          </p>
          <Link href={`/midterms/${a.raceId}`} className="mt-callpop-race" onClick={() => dismiss(a.id)}>
            {a.label}
          </Link>
          <p className="small">{a.body}</p>
          <button type="button" className="btn quiet small mt-callpop-x" aria-label={`Dismiss ${a.label}`} onClick={() => dismiss(a.id)}>
            <CloseIcon />
          </button>
        </div>
      ))}
      <p className="mt-callpop-foot small">
        {more > 0 && (
          <Link href="/midterms#latest-calls" className="muted">
            +{more} more {more === 1 ? "call" : "calls"}
          </Link>
        )}
        {canNotify && (
          <button type="button" className="mt-linkish" onClick={() => void turnOnNotifications()}>
            Alert me in other tabs
          </button>
        )}
        <button type="button" className="mt-linkish" onClick={() => setMuted("off")}>
          Stop pop-ups
        </button>
      </p>
    </aside>
  );
}
