"use client";
// A wall screen (lib/midterms/wall.ts): one office's live results for a TV or a spare monitor, read from across the
// room. Nothing to click: the map tours the closest races on its own, the cards fill the space without scrolling,
// and the type grows with the screen (+ and - adjust it). It never joins the two-screen setup, so a wall on a monitor
// plugged into the same computer can't take over as the main screen or become a companion.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import { readMock } from "@/lib/midterms/clock";
import { closestFirst } from "@/lib/midterms/explore";
import { countdown, electionModeDefault, formatTime, nextWave } from "@/lib/midterms/polls";
import type { RaceDetail } from "@/lib/midterms/races";
import { votesLeft } from "@/lib/midterms/votesLeft";
import { autoScale, nextScale, TOUR, tourRaces, tourStops, type TourPlan } from "@/lib/midterms/wall";
import { lead, raceLabel, STATE_NAMES, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { CallsFeed } from "./CallsFeed";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { fillFor } from "./county";
import { useClock, useLive } from "./hooks";
import { districtFill, nationDistrictFills, regularFirst, SeatHeader, stateFills } from "./OfficeView";
import { RaceCard } from "./RaceCard";
import { PollSchedule } from "./PollClose";
import { RaceRows } from "./RaceRows";
import { VotesLeftCard } from "./VotesLeft";
import { ZoomMap, type Fill } from "./ZoomMap";

export type WallOffice = Extract<Office, "senate" | "house">;
const TITLE: Record<WallOffice, string> = { senate: "Senate", house: "House" };
/** The most rows the closest-races table holds; the screen shows as many as fit. */
const MAX_ROWS = 60;
/**
 * How many of the tour's next races get a card. Under the whole-country map two fit side by side (wall.css hides the
 * third); an ultrawide stacks them beside the map, as many as fit, then lists the rest of the tour as rows.
 */
const UP_NEXT = 3;
/** How far a card starts below its place as it fades in (.mt-in in midterms.css), plus a pixel of rounding. */
const SLIDE_PX = 5;
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

/** How much bigger than normal to draw: grown to the window, times the viewer's +/- adjustment. */
function useWallScale(office: WallOffice): number {
  const scale = useSyncExternalStore(subscribeSize, () => autoScale(window.innerWidth, window.innerHeight) * readAdjust(office), () => 1);
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

/** The tour's current stop (a race id, or null for the whole country) and the rest of its races, in the order it visits them. Moves on by itself. */
function useTour(stops: readonly (number | null)[], plan: TourPlan): { stop: number | null; upNext: number[] } {
  const [i, setI] = useState(0);
  const at = i % stops.length;
  const stop = stops[at];
  useEffect(() => {
    const t = setTimeout(() => setI(at + 1), stop === null ? plan.nationMs : plan.raceMs);
    return () => clearTimeout(t);
  }, [at, stop, plan]);
  const ahead = [...stops.slice(at + 1), ...stops.slice(0, at)].filter((id): id is number => id !== null && id !== stop);
  return { stop, upNext: ahead };
}

/**
 * Hides every one of `items` from the first that runs past the bottom of `box`, so a list ends on a whole row.
 * `slidePx` is how far the items may sit below their place while fading in.
 */
function hidePastBottom(box: HTMLElement, items: HTMLElement[], slidePx = SLIDE_PX) {
  const rect = box.getBoundingClientRect();
  // Showing a card again restarts its fade-in (.mt-in), which starts it a few pixels low; that doesn't count as
  // running past the bottom. The slack is in screen pixels, so it grows with the wall's scale.
  const slack = slidePx * (rect.height / (box.offsetHeight || 1));
  const first = items.findIndex((x) => x.getBoundingClientRect().bottom > rect.bottom + slack);
  if (first >= 0) items.slice(first).forEach((x) => (x.hidden = true));
}

/** Every element in `box` matching `selector`, shown again so it can be measured. */
function showAll(box: HTMLElement, selector: string): HTMLElement[] {
  const all = [...box.querySelectorAll<HTMLElement>(selector)];
  all.forEach((x) => (x.hidden = false));
  return all;
}

const fitList = (selector: string) => (box: HTMLElement) => hidePastBottom(box, showAll(box, selector));
const fitRows = fitList(".mt-rows tbody tr, .mt-wall-grid .mt-card");
const fitCalls = fitList(".mt-el-calllist > li");

/** The tour's next races: whole cards first, then rows for the later races, skipping the ones with a card showing. */
function fitTour(box: HTMLElement) {
  const cards = showAll(box, ".mt-wall-upnext .mt-card");
  hidePastBottom(box, cards);
  const carded = cards.filter((c) => !c.hidden && c.getClientRects().length > 0).length;
  const rows = showAll(box, ".mt-wall-later tbody tr");
  rows.slice(0, carded).forEach((x) => (x.hidden = true));
  // The rows don't fade in, so only rounding is allowed for.
  hidePastBottom(box, rows.slice(carded), 1);
}

/**
 * Runs `fit` on `box` (hiding whatever runs past its bottom, so a list fills its space with whole rows instead of one
 * cut in half) after every render and whenever the box or its contents change. `ready` is false until the box is on
 * the page (the wall draws its lists once results arrive).
 */
function useFit(box: RefObject<HTMLElement | null>, fitBox: (box: HTMLElement) => void, ready: boolean) {
  const fit = () => {
    if (box.current) fitBox(box.current);
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
    // fit reads only the ref and the fitting function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, fitBox, ready]);
}

/** A race's lead as the map labels it ("+6.4"), or undefined before votes. */
function leadText(race: RaceSummary | undefined): string | undefined {
  const ahead = race && lead(race.candidates);
  return ahead ? `+${ahead.margin.toFixed(1)}` : undefined;
}

/**
 * The map, zoomed out to the country or into the tour's current race with its counties (or districts) shaded. The
 * House's stays on the country with the race's district marked (TOUR in wall.ts).
 */
function TourMap({ office, races, updatedAt, results, race: toured, detail }: { office: WallOffice; races: RaceSummary[]; updatedAt: number | null; results: boolean; race: RaceSummary | null; detail: RaceDetail | null }) {
  const zooms = TOUR[office].racesPerLeg !== null;
  const race = zooms ? toured : null;
  const marked = !zooms && toured ? `${toured.state}-${toured.district ?? 0}` : null;
  const focus = race?.state ?? null;
  const fills = useMemo(() => {
    const base = stateFills(office, races, updatedAt, results);
    if (office !== "senate") return base;
    // The Senate wall has no table of races, so each state's label carries its race's lead.
    return new Map([...base].map(([state, fill]) => [state, { ...fill, lead: leadText(races.filter((r) => r.state === state).sort(regularFirst)[0]) }]));
  }, [office, races, updatedAt, results]);
  const nationDistricts = useMemo(() => (office === "house" ? nationDistrictFills(races, updatedAt, results) : undefined), [office, races, updatedAt, results]);
  const districtFills = useMemo(() => {
    if (office !== "house" || !focus) return undefined;
    const out = new Map<number, Fill>();
    for (const r of races.filter((x) => x.state === focus).sort(regularFirst)) if (r.district !== null && !out.has(r.district)) out.set(r.district, districtFill(r, updatedAt, results));
    return out;
  }, [office, races, focus, updatedAt, results]);
  const countyFills = useMemo(() => {
    if (!detail) return undefined;
    const out = new Map<string, Fill>();
    for (const c of detail.counties) if (c.fips) out.set(c.fips, { fill: fillFor(c, "results"), tip: null });
    return out;
  }, [detail]);
  return (
    <ZoomMap
      fills={fills}
      focus={focus}
      onFocus={noop}
      countyFills={race ? countyFills : null}
      raceId={race?.id ?? null}
      districtFills={districtFills}
      nationDistricts={nationDistricts}
      nationDistrict={marked}
      district={race?.district ?? null}
      label={race ? `Map zoomed to ${raceLabel(race)}` : `Map of 2026 ${TITLE[office].toLowerCase()} races${toured ? `, marking ${raceLabel(toured)}` : ""}`}
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

const noSubscribe = () => () => {};

/**
 * Marks a mock election night running in this browser. The wall covers the tracker's mock bar, so without this a
 * test left running would look like the real night.
 */
function MockTag() {
  const mocked = useSyncExternalStore(noSubscribe, () => readMock() !== null, () => false);
  return mocked ? <span className="mt-wall-mock">Mock night</span> : null;
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
  // The Senate wall shows its closest races (toss-ups first, then the next closest) as cards filling the screen, in
  // place of the table and the calls column.
  const cards = office === "senate";
  const tour = useMemo(() => tourRaces(races, office), [races, office]);
  const stops = useMemo(() => tourStops(tour.map((r) => r.id), TOUR[office].racesPerLeg), [tour, office]);
  const { stop: stopId, upNext } = useTour(stops, TOUR[office]);
  const stop = races.find((r) => r.id === stopId) ?? null;
  // The toured race with its counties, for the map's shading and the votes-left estimate under its card.
  const stopDetail = useLive<{ race: RaceDetail }>(stop ? `/api/midterms/race/${stop.id}` : null).data?.race ?? null;
  const left = stop && stop.total > 0 && stopDetail?.id === stop.id && votesLeft(stopDetail) ? stopDetail : null;
  const next = upNext.map((id) => races.find((r) => r.id === id)).filter((r): r is RaceSummary => !!r);
  // Poll closings matter until the last polls close; after that the calls get the whole column.
  const closing = nextWave(useClock(60_000)) !== null;
  const table = useRef<HTMLElement>(null);
  const side = useRef<HTMLElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useFit(table, fitRows, !!data);
  useFit(detail, fitTour, !!data);
  useFit(side, fitCalls, !!data);

  return (
    <div className="mt mt-wall" style={{ "--wall-scale": scale } as CSSProperties}>
      <div className="mt-wall-stage">
        <header className="mt-wall-head">
          <h1>{TITLE[office]}</h1>
          <MockTag />
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
            <div className={`mt-wall-body${cards ? " no-side" : ""}`}>
              <section className="mt-wall-tour" aria-label="Race tour">
                <div className="mt-section-head tight">
                  <h2>{stop ? `${STATE_NAMES[stop.state] ?? stop.state}${office === "house" && stop.district !== null ? ` · District ${stop.district || "at large"}` : ""}` : "Every race"}</h2>
                  {tour.length > 0 && <span className="muted small">Touring the {tour.length} closest</span>}
                </div>
                <div className="mt-wall-map">
                  <TourMap office={office} races={races} updatedAt={data.ratings.updatedAt} results={results} race={stop} detail={stopDetail} />
                </div>
                {/* Under the map, the toured race or (on the whole country) the next ones; an ultrawide shows both. */}
                <div className="mt-wall-detail" ref={detail}>
                  {stop && (
                    <div className="mt-wall-spot mt-in" key={stop.id}>
                      <ul className="mt-grid one">
                        <RaceCard race={stop} starred={null} onStar={noop} limit={2} />
                      </ul>
                      {left && <VotesLeftCard race={left} brief />}
                    </div>
                  )}
                  {next.length > 0 && (
                    <div className="mt-wall-upnext mt-in" key={`next-${stopId}`}>
                      <h3>Up next on the tour</h3>
                      <ul className="mt-grid">
                        {next.slice(0, UP_NEXT).map((r) => (
                          <RaceCard key={r.id} race={r} starred={null} onStar={noop} limit={2} />
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* An ultrawide fills the rest of the column with the rest of the tour, a row each. */}
                  {next.length > 0 && (
                    <div className="mt-wall-later">
                      <h3>Later on the tour</h3>
                      <RaceRows races={next} star={NO_STARS} />
                    </div>
                  )}
                </div>
              </section>
              {cards ? (
                <section className="mt-wall-cards mt-wall-grid" aria-label="Closest races" ref={table}>
                  <div className="mt-section-head tight">
                    <h2>Closest races</h2>
                    <span className="muted small">Toss-ups first · {races.length} races</span>
                  </div>
                  <ul className="mt-grid">
                    {closest.map((r) => (
                      <RaceCard key={r.id} race={r} starred={null} onStar={noop} limit={2} />
                    ))}
                  </ul>
                </section>
              ) : (
                <section className="mt-wall-cards" aria-label="Closest races" ref={table}>
                  <div className="mt-section-head tight">
                    <h2>Closest races</h2>
                    <span className="muted small">{races.length} races</span>
                  </div>
                  <RaceRows races={closest} star={NO_STARS} selectedId={stopId} />
                </section>
              )}
              {!cards && (
                <aside className="mt-wall-side" aria-label="Latest calls" ref={side}>
                  {closing && <PollSchedule races={races} />}
                  <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office={office} />
                </aside>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
