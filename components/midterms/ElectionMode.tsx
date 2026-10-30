"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { clockNow } from "@/lib/midterms/clock";
import { explore, fromQuery, QUERY_KEYS, toQuery, type Filters } from "@/lib/midterms/explore";
import { electionModeDefault, stampET } from "@/lib/midterms/polls";
import { OFFICE_LABEL, partyTag, type Office, type Overview } from "@/lib/midterms/view";
import { CallsFeed } from "./CallsFeed";
import { ControlStrip } from "./ControlStrip";
import { ElectionMap } from "./ElectionMap";
import { Explorer } from "./Explorer";
import { useClock, type useStars } from "./hooks";
import { NextClose, PollSchedule, shortLabel } from "./PollClose";
import { SeatBoard, type FillMode } from "./SeatBoard";
import { PhotoCredit } from "./Avatar";
import { RailContext } from "./railSplit";

const OFFICES: (Office | "all")[] = ["senate", "house", "governor", "measure", "all"];
const HREF = { senate: "/midterms/senate", house: "/midterms/house", governor: "/midterms/governor", measure: "/midterms/measures" } as const;
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

/** Filters live in the URL so a view can be shared or bookmarked; other query parameters are left alone. */
function useUrlFilters() {
  const [f, setF] = useState<Filters>(() => fromQuery(new URLSearchParams(window.location.search)));
  // Back and forward restore the filters that URL held.
  useEffect(() => {
    const onPop = () => setF(fromQuery(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const k of QUERY_KEYS) url.searchParams.delete(k);
    for (const [k, v] of new URLSearchParams(toQuery(f))) url.searchParams.set(k, v);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [f]);
  const set = useCallback((next: Partial<Filters>) => setF((prev) => ({ ...prev, ...next })), []);
  return [f, set] as const;
}

const CLEARED: Partial<Filters> = { view: "all", q: "", states: [], status: [], tiers: [], leaders: [], maxMargin: null, minReporting: null, waves: [] };

const toggle = <T,>(list: readonly T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

/**
 * On narrow screens, where the calls feed sits below the list, the newest update stays one tap away.
 * A withdrawn or changed call in the last half hour outranks a routine call.
 */
function LatestLink({ races }: { races: Overview["races"] }) {
  const events = races.filter((r) => r.call).sort((a, b) => b.call!.at - a.call!.at);
  const newest = events[0];
  if (!newest) return null;
  const correction = events.find((r) => (r.call!.withdrawn || r.call!.replaced) && newest.call!.at - r.call!.at < 30 * 60_000);
  const r = correction ?? newest;
  const won = r.candidates.find((c) => c.winner);
  const what = r.call!.withdrawn ? `call for ${r.call!.replaced} withdrawn` : won ? `${won.name}${partyTag(won.party) ? ` (${partyTag(won.party)})` : ""}${r.call!.replaced ? `, changed from ${r.call!.replaced}` : ""}` : "updated";
  return (
    <a href="#latest-calls" className={`mt-el-latest small${correction ? " warn" : ""}`}>
      <b>{correction ? "Correction" : "Latest call"}</b> {stampET(r.call!.at)} · {shortLabel(r)}: {what} →
    </a>
  );
}

/** Election night in one place: control of each chamber, the next poll closing, every race filterable, the latest calls and the map. */
export function ElectionMode({ data, stars }: { data: Overview; stars: ReturnType<typeof useStars> }) {
  const [f, set] = useUrlFilters();
  const [fillMode, setFillMode] = useState<FillMode>("results");
  // The side rail's boxes and the full-width slot under the layout, for the race list to flow past the rail.
  const [mapbox, setMapbox] = useState<HTMLElement | null>(null);
  const [callbox, setCallbox] = useState<HTMLElement | null>(null);
  const [schedbox, setSchedbox] = useState<HTMLElement | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const rail = useMemo(() => ({ boxes: [mapbox, callbox, schedbox].filter((b): b is HTMLElement => !!b), slot }), [mapbox, callbox, schedbox, slot]);
  const counts = useMemo(() => Object.fromEntries(OFFICES.map((o) => [o, o === "all" ? data.races.length : data.races.filter((r) => r.office === o).length])), [data.races]);
  const mapOffice: Office = f.office === "all" ? "senate" : f.office;
  const pickState = (state: string) => set({ states: toggle(f.states, state) });
  const matching = useMemo(() => new Set(explore(data.races, { ...f, office: "house" }, stars.ids).map((r) => r.id)), [data.races, f, stars.ids]);

  return (
    <div className="mt-el">
      <ControlStrip data={data}>
        <NextClose races={data.races} onPick={(at) => set({ ...CLEARED, office: "all", waves: [at] })} />
      </ControlStrip>

      <div className="mt-el-offices" role="tablist" aria-label="Office">
        {OFFICES.map((o) => (
          <button key={o} type="button" role="tab" className="tab" aria-selected={f.office === o} onClick={() => set({ office: o, states: [] })}>
            {o === "all" ? "All races" : OFFICE_LABEL[o]}
            <span className="tab-count">{counts[o]}</span>
          </button>
        ))}
      </div>

      <RailContext.Provider value={rail}>
      <div className="mt-el-grid">
        <div className="mt-el-list">
          <LatestLink races={data.races} />
          <Explorer races={data.races} f={f} set={set} stars={stars} />
        </div>
        <div className="mt-el-mapbox" ref={setMapbox}>
          <div className="mt-section-head tight">
            <h2>{mapOffice === "house" ? "Every House seat" : `${OFFICE_LABEL[mapOffice]} map`}</h2>
            {mapOffice !== "measure" && (
              <div className="mt-seg" role="group" aria-label="Colors show">
                {(["results", "ratings"] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={fillMode === m} onClick={() => setFillMode(m)}>
                    {m === "results" ? "Results" : "Ratings"}
                  </button>
                ))}
              </div>
            )}
            <Link href={HREF[mapOffice]} className="small">County maps →</Link>
            <Link href="/midterms/side-by-side" className="small mt-mode-wide">Side by side →</Link>
          </div>
          {mapOffice === "house" ? <SeatBoard races={data.races} selected={f.states} onState={pickState} matching={matching} mode={fillMode} /> : <ElectionMap office={mapOffice} races={data.races} selected={f.states} onState={pickState} mode={fillMode} />}
        </div>
        <div className="mt-el-callbox" ref={setCallbox}>
          <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office={f.office} />
        </div>
        <div className="mt-el-schedbox" ref={setSchedbox}>
          <PollSchedule races={f.office === "all" ? data.races : data.races.filter((r) => r.office === f.office)} picked={f.waves} onPick={(at) => set({ waves: toggle(f.waves, at) })} />
        </div>
      </div>
      <div className="mt-el-more" ref={setSlot} />
      </RailContext.Provider>

      <p className="muted small mt-source">
        Live results and calls from <a href="https://civicapi.org">civicAPI</a> and its own decision desk, collected from state and county election offices; not AP or Decision Desk HQ. &ldquo;Reporting&rdquo; is precincts or ballot batches in, not the share of the expected vote. Ratings come from <a href="https://kalshi.com">Kalshi</a> and <a href="https://polymarket.com">Polymarket</a>, or the <a href="https://votehub.com/polls">VoteHub</a> polling average where no market trades. Seat holders from <a href="https://github.com/unitedstates/congress-legislators">congress-legislators</a>.
        <PhotoCredit />
        {stars.guest && <> Your stars are saved in this browser; <Link href="/signin?next=/midterms">sign in</Link> to keep them on every device.</>}
      </p>
    </div>
  );
}
