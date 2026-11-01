"use client";
// A wall screen (lib/midterms/wall.ts): one office's live results for a TV or a spare monitor, read from across the
// room. Nothing to click: the map tours the closest races on its own, the cards fill the space without scrolling,
// and the type grows with the screen (+ and - adjust it). It never joins the two-screen setup, so a wall on a monitor
// plugged into the same computer can't take over as the main screen or become a companion.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import { closestFirst } from "@/lib/midterms/explore";
import { countdown, electionModeDefault, formatTime, nextWave } from "@/lib/midterms/polls";
import type { RaceDetail } from "@/lib/midterms/races";
import { autoScale, NATION_MS, nextScale, RACE_MS, tourRaces, tourStops } from "@/lib/midterms/wall";
import { raceLabel, STATE_NAMES, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { CallsFeed } from "./CallsFeed";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { fillFor } from "./county";
import { useClock, useLive } from "./hooks";
import { districtFill, nationDistrictFills, regularFirst, SeatHeader, stateFills } from "./OfficeView";
import { RaceCard } from "./RaceCard";
import { PollSchedule } from "./PollClose";
import { RaceRows } from "./RaceRows";
import { ZoomMap, type Fill } from "./ZoomMap";

export type WallOffice = Extract<Office, "senate" | "house">;
const TITLE: Record<WallOffice, string> = { senate: "Senate", house: "House" };
/** The most rows the closest-races table holds; the screen shows as many as fit. */
const MAX_ROWS = 60;
/** How many of the tour's next races show under the whole-country map; more get too narrow to read. */
const UP_NEXT = 2;
/** No star column on a wall: nothing on it is clicked. */
const NO_STARS = { ids: null, toggle: () => {} };
const noop = () => {};

/** The viewer's size adjustment for this office's wall, kept in this browser so a reload keeps it. */
const scaleKey = (office: WallOffice) => `mt-wall-scale-${office}`;
const SCALE_CHANGED = "mt-wall-scale";

function readAdjust(office: WallOffice): number {
  try {
    const n = Number(localStorage.getItem(scaleKey(office)));
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function subscribeSize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  window.addEventListener(SCALE_CHANGED, onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener(SCALE_CHANGED, onChange);
  };
}

/** How much bigger than normal to draw: grown to the window's width, times the viewer's +/- adjustment. */
function useWallScale(office: WallOffice): number {
  const scale = useSyncExternalStore(subscribeSize, () => autoScale(window.innerWidth) * readAdjust(office), () => 1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key === "=" ? "+" : e.key;
      if (key !== "+" && key !== "-" && key !== "0") return;
      try {
        localStorage.setItem(scaleKey(office), String(nextScale(readAdjust(office), key)));
      } catch {
        return; // Storage off: the size can't change.
      }
      window.dispatchEvent(new Event(SCALE_CHANGED));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [office]);
  return scale;
}

/** Keeps the screen from dimming or sleeping while the wall is showing, where the browser allows it. */
function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(
        (l) => (lock = l),
        () => {}, // Refused (battery saver, or the page isn't focused yet): the screen follows its own sleep setting.
      );
    };
    take();
    // The browser drops the lock when the tab is hidden; take it again on return.
    document.addEventListener("visibilitychange", take);
    return () => {
      document.removeEventListener("visibilitychange", take);
      lock?.release().catch(() => {});
    };
  }, []);
}

/**
 * The tour's current stop (a race id, or null for the whole country) and, on the whole country, the races it visits
 * next. Moves on by itself.
 */
function useTour(stops: readonly (number | null)[]): { stop: number | null; upNext: number[] } {
  const [i, setI] = useState(0);
  const at = i % stops.length;
  const stop = stops[at];
  useEffect(() => {
    const t = setTimeout(() => setI(at + 1), stop === null ? NATION_MS : RACE_MS);
    return () => clearTimeout(t);
  }, [at, stop]);
  const rest = stops.slice(at + 1);
  const leg = rest.slice(0, rest.indexOf(null) === -1 ? rest.length : rest.indexOf(null));
  return { stop, upNext: stop === null ? (leg as number[]).slice(0, UP_NEXT) : [] };
}

/**
 * Hides every `items` element inside `box` from the first one that runs past the box's bottom, so a list fills its
 * space with whole rows instead of one cut in half. Runs after every render and whenever the box or its contents change.
 */
function useFit(box: RefObject<HTMLElement | null>, items: string) {
  const fit = () => {
    const el = box.current;
    if (!el) return;
    const all = [...el.querySelectorAll<HTMLElement>(items)];
    all.forEach((x) => (x.hidden = false));
    const bottom = el.getBoundingClientRect().bottom;
    const first = all.findIndex((x) => x.getBoundingClientRect().bottom > bottom + 1);
    if (first >= 0) all.slice(first).forEach((x) => (x.hidden = true));
  };
  useLayoutEffect(fit);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = new ResizeObserver(() => fit());
    size.observe(el);
    // A list that loads or redraws on its own (the calls feed) changes without this component rendering.
    const content = new MutationObserver(() => fit());
    content.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      size.disconnect();
      content.disconnect();
    };
    // fit reads only the ref and the selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, items]);
}

/** The map, zoomed out to the country or into the tour's current race with its counties (or districts) shaded. */
function TourMap({ office, races, updatedAt, results, race }: { office: WallOffice; races: RaceSummary[]; updatedAt: number | null; results: boolean; race: RaceSummary | null }) {
  const focus = race?.state ?? null;
  const fills = useMemo(() => stateFills(office, races, updatedAt, results), [office, races, updatedAt, results]);
  const nationDistricts = useMemo(() => (office === "house" ? nationDistrictFills(races, updatedAt, results) : undefined), [office, races, updatedAt, results]);
  const districtFills = useMemo(() => {
    if (office !== "house" || !focus) return undefined;
    const out = new Map<number, Fill>();
    for (const r of races.filter((x) => x.state === focus).sort(regularFirst)) if (r.district !== null && !out.has(r.district)) out.set(r.district, districtFill(r, updatedAt, results));
    return out;
  }, [office, races, focus, updatedAt, results]);
  const detail = useLive<{ race: RaceDetail }>(race ? `/api/midterms/race/${race.id}` : null);
  const countyFills = useMemo(() => {
    if (!detail.data) return undefined;
    const out = new Map<string, Fill>();
    for (const c of detail.data.race.counties) if (c.fips) out.set(c.fips, { fill: fillFor(c, "results"), tip: null });
    return out;
  }, [detail.data]);
  return (
    <ZoomMap
      fills={fills}
      focus={focus}
      onFocus={noop}
      countyFills={race ? countyFills : null}
      raceId={race?.id ?? null}
      districtFills={districtFills}
      nationDistricts={nationDistricts}
      district={race?.district ?? null}
      label={race ? `Map zoomed to ${raceLabel(race)}` : `Map of 2026 ${TITLE[office].toLowerCase()} races`}
    />
  );
}

/** When the next polls close, in the viewer's zone, with a countdown. */
function NextClose({ now }: { now: number }) {
  const wave = nextWave(now);
  if (!wave) return null;
  return (
    <span className="mt-wall-next">
      Next polls close {formatTime(wave.at)} · <b>{countdown(wave.at - now)}</b>
    </span>
  );
}

/** The header's clock and next poll closing, ticking every second on their own so the rest of the wall doesn't redraw. */
function Clock() {
  const now = useClock(1000);
  return (
    <>
      <NextClose now={now} />
      <span className="mt-wall-clock">{formatTime(now)}</span>
    </>
  );
}

/** One office's wall screen. */
export function Wall({ office }: { office: WallOffice }) {
  const { data, error } = useLive<Overview>("/api/midterms", { office });
  const forecast = useLive<ForecastOverview>("/api/midterms/forecast").data;
  const results = electionModeDefault(useClock(60_000));
  const scale = useWallScale(office);
  useWakeLock();

  const races = useMemo(() => (data?.races ?? []).filter((r) => r.office === office), [data, office]);
  const closest = useMemo(() => [...races].sort(closestFirst).slice(0, MAX_ROWS), [races]);
  const tour = useMemo(() => tourRaces(races, office), [races, office]);
  const stops = useMemo(() => tourStops(tour.map((r) => r.id)), [tour]);
  const { stop: stopId, upNext } = useTour(stops);
  const stop = races.find((r) => r.id === stopId) ?? null;
  const next = upNext.map((id) => races.find((r) => r.id === id)).filter((r): r is RaceSummary => !!r);
  // Poll closings matter until the last polls close; after that the calls get the whole column.
  const closing = nextWave(useClock(60_000)) !== null;
  const table = useRef<HTMLElement>(null);
  const side = useRef<HTMLElement>(null);
  useFit(table, ".mt-rows tbody tr");
  useFit(side, ".mt-el-calllist > li");

  return (
    <div className="mt mt-wall" style={{ "--wall-scale": scale } as CSSProperties}>
      <div className="mt-wall-stage">
        <header className="mt-wall-head">
          <h1>{TITLE[office]}</h1>
          {data && (
            <span className="mt-wall-status">
              <LiveDot at={data.fetchedAt} stale={data.stale} /> Checked <CheckedAgo at={data.fetchedAt} />
              {data.stale && " · source is slow"}
            </span>
          )}
          <Clock />
        </header>
        {error && <p className="error">{data ? `${error} Showing the last results we got.` : error}</p>}
        {!data && !error && <p className="muted">Loading results…</p>}
        {data && (
          <>
            <SeatHeader office={office} data={data} forecast={forecast} />
            <div className="mt-wall-body">
              <section className="mt-wall-tour" aria-label="Race tour">
                <div className="mt-section-head tight">
                  <h2>{stop ? `${STATE_NAMES[stop.state] ?? stop.state}${office === "house" && stop.district !== null ? ` · District ${stop.district || "at large"}` : ""}` : "Every race"}</h2>
                  {tour.length > 0 && <span className="muted small">Touring the {tour.length} closest</span>}
                </div>
                <div className="mt-wall-map">
                  <TourMap office={office} races={races} updatedAt={data.ratings.updatedAt} results={results} race={stop} />
                </div>
                {stop ? (
                  <ul className="mt-grid one mt-wall-spot mt-in" key={stop.id}>
                    <RaceCard race={stop} starred={null} onStar={noop} />
                  </ul>
                ) : (
                  next.length > 0 && (
                    <div className="mt-wall-upnext mt-in">
                      <h3>Up next on the tour</h3>
                      <ul className="mt-grid">
                        {next.map((r) => (
                          <RaceCard key={r.id} race={r} starred={null} onStar={noop} limit={2} />
                        ))}
                      </ul>
                    </div>
                  )
                )}
              </section>
              <section className="mt-wall-cards" aria-label="Closest races" ref={table}>
                <div className="mt-section-head tight">
                  <h2>Closest races</h2>
                  <span className="muted small">{races.length} races</span>
                </div>
                <RaceRows races={closest} star={NO_STARS} selectedId={stopId} />
              </section>
              <aside className="mt-wall-side" aria-label="Latest calls" ref={side}>
                {closing && <PollSchedule races={races} />}
                <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office={office} />
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
