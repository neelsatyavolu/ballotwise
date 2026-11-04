"use client";
// A wall screen (lib/midterms/wall.ts): one office's live results for a TV or a spare monitor, read from across the
// room. Nothing to click: the map tours the closest races on its own, the cards fill the space without scrolling,
// and the type grows with the screen (+ and - adjust it). It never joins the two-screen setup, so a wall on a monitor
// plugged into the same computer can't take over as the main screen or become a companion.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import { readMock } from "@/lib/midterms/clock";
import { isCalled, isTossup, isWatch, watchFirst } from "@/lib/midterms/explore";
import { countdown, formatTime, nextWave, showsResults } from "@/lib/midterms/polls";
import type { RaceDetail } from "@/lib/midterms/races";
import { autoScale, nextScale, TOUR, tourRaces, tourStops, type TourPlan } from "@/lib/midterms/wall";
import { raceLabel, STATE_NAMES, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { fillFor } from "./county";
import { useClock, useLive } from "./hooks";
import { districtFill, nationDistrictFills, regularFirst, SeatHeader, stateFills, withLeads } from "./OfficeView";
import { closingPlaces } from "./PollClose";
import { RaceCard } from "./RaceCard";
import { MomentPopup } from "./MomentPopup";
import { RaceRows } from "./RaceRows";
import { ROTATE_MS, useRotatingFit } from "./useRotatingFit";
import { ZoomMap, type Fill } from "./ZoomMap";

export type WallOffice = Extract<Office, "senate" | "house">;
const TITLE: Record<WallOffice, string> = { senate: "Senate", house: "House" };
/** The most cards the Senate wall lays out; the screen shows as many as fit. */
const MAX_CARDS = 60;
/**
 * How many of the tour's next races get a card. Under the whole-country map two fit side by side (wall.css hides the
 * third); an ultrawide stacks them beside the map, as many as fit, then lists the rest of the tour as rows.
 */
const UP_NEXT = 3;
/**
 * The House's grid follows its toss-ups with this many leans, those nearest a toss-up (counting ones by their lead,
 * the rest by their forecast). Kept short: where the grid rotates (it doesn't all fit), each lean adds to the time
 * before the toss-ups come around again.
 */
const CLOSE_LEANS = 8;
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

/**
 * The map, zoomed out to the country or into the tour's current race with its counties (or districts) shaded. The
 * House's stays on the country with the race's district marked (TOUR in wall.ts).
 */
function TourMap({ office, races, updatedAt, results, race: toured, detail }: { office: WallOffice; races: RaceSummary[]; updatedAt: number | null; results: boolean; race: RaceSummary | null; detail: RaceDetail | null }) {
  const zooms = TOUR[office].racesPerLeg !== null;
  const race = zooms ? toured : null;
  const marked = !zooms && toured ? `${toured.state}-${toured.district ?? 0}` : null;
  const focus = race?.state ?? null;
  // On the Senate's map each state's label carries its race's lead.
  const fills = useMemo(() => {
    const base = stateFills(office, races, updatedAt, results);
    return office === "senate" ? withLeads(base, races) : base;
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

/**
 * When the next polls close and where, in the viewer's zone, with a countdown. A * marks a state where only some polls
 * close then; the full place names are in the hover title.
 */
function NextClose({ now }: { now: number }) {
  const wave = nextWave(now);
  if (!wave) return null;
  const where = wave.states.map((s) => (s.part === "all" ? s.state : `${s.state}*`)).join(", ");
  return (
    <span className="mt-wall-next" title={closingPlaces(wave.states)}>
      Next polls close {formatTime(wave.at)} in {where} · <b>{countdown(wave.at - now)}</b>
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
  const results = showsResults(useClock(60_000));
  const scale = useWallScale(office);
  useWakeLock();

  const races = useMemo(() => (data?.races ?? []).filter((r) => r.office === office), [data, office]);
  // The cards beside the map: the Senate's closest races (counting toss-ups and leans first), as many as fit; the
  // House's toss-ups and then its closest leans (CLOSE_LEANS), a screenful at a time when they don't all fit.
  // Toss-ups that look set to flip come first (watchFirst).
  const cards = useMemo(
    () =>
      office === "senate"
        ? [...races].sort(watchFirst).slice(0, MAX_CARDS)
        : [...races.filter(isTossup).sort(watchFirst), ...races.filter((r) => r.rating?.startsWith("lean") && !isCalled(r)).sort(watchFirst).slice(0, CLOSE_LEANS)],
    [races, office],
  );
  const tour = useMemo(() => tourRaces(races, office), [races, office]);
  // A card clicked pins the map to its race until it's clicked again. Otherwise, with one toss-up left counting, the
  // map stays on it; with more, it tours.
  const [pinned, setPinned] = useState<number | null>(null);
  const lone = useMemo(() => {
    const active = races.filter((r) => isWatch(r) && r.total > 0);
    return active.length === 1 ? active[0].id : null;
  }, [races]);
  const focusOn = pinned !== null && races.some((r) => r.id === pinned) ? pinned : lone;
  const stops = useMemo(() => (focusOn !== null ? [focusOn] : tourStops(tour.map((r) => r.id), TOUR[office].racesPerLeg)), [focusOn, tour, office]);
  const { stop: stopId, upNext } = useTour(stops, TOUR[office]);
  const stop = races.find((r) => r.id === stopId) ?? null;
  // The toured race with its counties, for the map's shading.
  const stopDetail = useLive<{ race: RaceDetail }>(stop ? `/api/midterms/race/${stop.id}` : null).data?.race ?? null;
  const next = upNext.map((id) => races.find((r) => r.id === id)).filter((r): r is RaceSummary => !!r);
  const grid = useRef<HTMLUListElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useRotatingFit(grid, office === "house" ? ROTATE_MS : null, !!data);
  useFit(detail, fitTour, !!data);
  // The toured race's card in the grid is outlined (its own card shows under the map too, with its count).
  useLayoutEffect(() => {
    for (const card of [...(grid.current?.children ?? [])] as HTMLElement[]) card.classList.toggle("on", stopId !== null && Number(card.dataset.race) === stopId);
  });
  // A click on a card pins the map to it (or unpins it) instead of leaving the wall for the race page.
  const pin = (e: ReactMouseEvent<HTMLUListElement>) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-race]");
    if (!card) return;
    e.preventDefault();
    const id = Number(card.dataset.race);
    setPinned((p) => (p === id ? null : id));
  };

  return (
    <div className="mt mt-wall" style={{ "--wall-scale": scale } as CSSProperties}>
      <div className="mt-wall-stage">
        <header className="mt-wall-head">
          <h1>{TITLE[office]}</h1>
          <MockTag />
          {data && <MomentPopup data={data} />}
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
                  <h2>
                    {stop ? `${STATE_NAMES[stop.state] ?? stop.state}${office === "house" && stop.district !== null ? ` · District ${stop.district || "at large"}` : ""}` : "Every race"}
                    {stop && stop.id === pinned ? " · pinned" : stop && stop.id === lone ? " · the last toss-up counting" : ""}
                  </h2>
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
                        <RaceCard race={stop} starred={null} onStar={noop} limit={2} bare />
                      </ul>
                    </div>
                  )}
                  {/* The Senate's grid already holds its closest races, so only the House's wall lists what's next. */}
                  {office === "house" && next.length > 0 && (
                    <div className="mt-wall-upnext mt-in" key={`next-${stopId}`}>
                      <h3>Up next on the tour</h3>
                      <ul className="mt-grid">
                        {next.slice(0, UP_NEXT).map((r) => (
                          <RaceCard key={r.id} race={r} starred={null} onStar={noop} limit={2} bare />
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* An ultrawide fills the rest of the column with the rest of the tour, a row each. */}
                  {office === "house" && next.length > 0 && (
                    <div className="mt-wall-later">
                      <h3>Later on the tour</h3>
                      <RaceRows races={next} star={NO_STARS} />
                    </div>
                  )}
                </div>
              </section>
              <section className="mt-wall-cards" aria-label={office === "senate" ? "Closest races" : "Toss-ups and closest leans"}>
                <div className="mt-section-head tight">
                  <h2>{office === "senate" ? "Closest races" : "Toss-ups and closest leans"}</h2>
                  <span className="muted small">{office === "senate" ? `Counting toss-ups, then leans, first · ${races.length} races` : `${cards.length} races`}</span>
                </div>
                <ul className="mt-grid" ref={grid} onClickCapture={pin}>
                  {cards.map((r) => (
                    <RaceCard key={r.id} race={r} starred={null} onStar={noop} limit={2} bare />
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
