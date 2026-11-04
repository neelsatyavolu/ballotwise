"use client";

import { useDeskDetail } from "./useDeskDetail";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { parseWeights, resize } from "@/lib/midterms/columns";
import { closestFirst, isCalled, watchFirst } from "@/lib/midterms/explore";
import { showsResults } from "@/lib/midterms/polls";
import type { ForecastOverview } from "@/app/api/midterms/forecast/route";
import type { RaceDetail } from "@/lib/midterms/races";
import { STATE_NAMES, type Office, type Overview } from "@/lib/midterms/view";
import { CallsFeed } from "./CallsFeed";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { CountyTip, fillFor } from "./county";
import { RemainingButton, useRemaining } from "./remaining";
import { useClock, useLive, useStars } from "./hooks";
import { ModeNav } from "./ModeNav";
import { MomentPopup } from "./MomentPopup";
import { districtFill, nationDistrictFills, regularFirst, SeatHeader, stateFills, withLeads } from "./OfficeView";
import { PollSchedule } from "./PollClose";
import { RaceCard } from "./RaceCard";
import { RaceRows, type Star } from "./RaceRows";
import { ColumnsSkeleton } from "./Skeleton";
import { useRotatingFit } from "./useRotatingFit";
import { ZoomMap, type Fill } from "./ZoomMap";

type Column = Exclude<Office, "measure">;
const count = (n: number) => `${n} race${n === 1 ? "" : "s"}`;
const COLUMNS: { office: Column; title: string; href: string }[] = [
  { office: "senate", title: "Senate", href: "/midterms/senate" },
  { office: "house", title: "House", href: "/midterms/house" },
  { office: "governor", title: "Governors", href: "/midterms/governor" },
];

/**
 * One office's dashboard, compact enough to sit beside the other two: seat bar, map and closest races. Picking a
 * state, a district or a race zooms this column's map in and opens the race right here, with its counties shaded,
 * the way the office screens do; the full page is a link away.
 */
function OfficeColumn({ office, title, href, data, forecast, results, star, status, handle, toggle }: { office: Column; title: string; href: string; data: Overview; forecast: ForecastOverview | null; results: boolean; star: Star; status?: ReactNode; handle?: ReactNode; toggle?: ReactNode }) {
  const [focus, setFocus] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const races = useMemo(() => data.races.filter((r) => r.office === office), [data, office]);
  const updatedAt = data.ratings.updatedAt;
  // On the Senate's map each state's label carries its race's lead, as on the Senate wall.
  const fills = useMemo(() => {
    const base = stateFills(office, races, updatedAt, results);
    return office === "senate" || office === "governor" ? withLeads(base, races) : base;
  }, [office, races, updatedAt, results]);
  const nationDistricts = useMemo(() => (office === "house" ? nationDistrictFills(races, updatedAt, results) : undefined), [office, races, updatedAt, results]);
  const inState = useMemo(() => races.filter((r) => r.state === focus).sort((a, b) => regularFirst(a, b) || closestFirst(a, b) || (a.district ?? 0) - (b.district ?? 0)), [races, focus]);
  // A statewide office opens the state's regular race when none is picked; the House waits for a district.
  const shownId = focus ? (picked && inState.some((r) => r.id === picked) ? picked : office === "house" ? null : (inState[0]?.id ?? null)) : null;
  const shown = inState.find((r) => r.id === shownId) ?? null;
  const detail = useLive<{ race: RaceDetail }>(shownId ? `/api/midterms/race/${shownId}` : null);
  // On a connected screen, DDHQ's own counties for the shown race, as on the office pages.
  const shownDetail = useDeskDetail(detail.data?.race, detail.data as { fetchedAt?: number } | null, shown);
  const countyFills = useMemo(() => {
    if (!shownDetail) return null;
    const out = new Map<string, Fill>();
    // New England's towns are drawn as towns (ZoomMap loads its town layer for town-keyed fills).
    for (const c of shownDetail.counties) if (c.fips) out.set(c.fips, { fill: fillFor(c, "results"), tip: <CountyTip county={c} /> });
    return out;
  }, [shownDetail]);
  // The Remaining view, switched on from the race card: circles sized by each county's votes left.
  const [showLeft, setShowLeft] = useState(false);
  const remaining = useRemaining(shownDetail);
  const leftOn = showLeft && !!remaining;
  const districtFills = useMemo(() => {
    if (office !== "house") return undefined;
    const out = new Map<number, Fill>();
    for (const r of inState) if (r.district !== null && !out.has(r.district)) out.set(r.district, districtFill(r, updatedAt, results));
    return out;
  }, [office, inState, updatedAt, results]);
  const closest = useMemo(() => [...races].sort(watchFirst), [races]);
  const zoomTo = (state: string | null, raceId: number | null = null) => {
    setFocus(state);
    setPicked(raceId);
  };

  return (
    <section className="mt-sbs-col" aria-label={`${title} dashboard`}>
      <div className="mt-section-head tight">
        <h2>
          <Link href={href}>{title}</Link>
        </h2>
        <span className="muted small mt-sbs-count">
          {focus ? `${STATE_NAMES[focus] ?? focus} · ${count(inState.length)}` : count(races.length)}
          {status}
        </span>
        {toggle}
      </div>
      <SeatHeader office={office} data={data} forecast={forecast} />
      <ZoomMap
        fills={fills}
        focus={focus}
        onFocus={(state) => zoomTo(state)}
        countyFills={focus && shownId ? (shownDetail ? (leftOn ? remaining!.fills : countyFills) : undefined) : null}
        bubbles={leftOn ? remaining!.bubbles : null}
        raceId={shownId}
        districtFills={districtFills}
        nationDistricts={nationDistricts}
        onPickNationDistrict={(key) => {
          const r = races.find((x) => `${x.state}-${x.district ?? 0}` === key);
          if (r) zoomTo(r.state, r.id);
        }}
        district={shown?.district ?? null}
        onPickDistrict={(d) => setPicked(shown?.district === d ? null : (inState.find((r) => r.district === d)?.id ?? null))}
        label={`Map of 2026 ${title.toLowerCase()} races${focus ? `, zoomed to ${STATE_NAMES[focus] ?? focus}` : ""}`}
      />
      {focus ? (
        <div className="mt-sbs-focus mt-in" key={`${focus}-${shownId}`}>
          {/* The map's own back button returns to every state. */}
          <h3>{shown ? STATE_NAMES[focus] ?? focus : `${STATE_NAMES[focus] ?? focus}: pick a district`}</h3>
          {shown && (
            <>
              <ul className="mt-grid one">
                <RaceCard race={shown} starred={star.ids ? star.ids.includes(shown.id) : null} onStar={star.toggle} tool={remaining && <RemainingButton on={showLeft} onChange={setShowLeft} />} />
              </ul>
              <p className="small">
                <Link href={`/midterms/${shown.id}`}>Full results and every county →</Link>
              </p>
            </>
          )}
          {inState.length > 1 && <RaceRows races={inState} star={star} onPick={(r) => setPicked(r.id)} selectedId={shownId} />}
        </div>
      ) : (
        <RaceRows races={closest} star={star} onPick={(r) => zoomTo(r.state, r.id)} />
      )}
      {handle}
    </section>
  );
}

const WIDTHS_KEY = "mt-sbs-widths";
/** What the third column shows: the governors' dashboard, or cards for every Senate and House toss-up. */
const THIRD_KEY = "mt-sbs-third";
/** What the third column shows: the governors, toss-ups, the Senate's races as cards, or the latest calls. */
const THIRDS = ["governor", "tossups", "senate", "senatemap", "calls"] as const;
type Third = (typeof THIRDS)[number];
const THIRD_LABEL: Record<Third, string> = { governor: "Governors", tossups: "Toss-ups", senate: "Senate", senatemap: "Senate map", calls: "Calls" };
/** Fired when this page saves a setting, so every reader of it updates. */
const SETTINGS_CHANGED = "mt-sbs-settings";
/** Each column's share of the width: Senate, House, Governors, then the calls feed on ultrawide screens. */
const DEFAULT_WIDTHS = [1, 1, 1, 0.6];
/** The narrowest each column can be dragged to, in pixels. The calls feed's lines wrap, so it can go narrower. */
const MIN_PX = [300, 300, 300, 220];
/** How far an arrow key moves a divider. */
const KEY_STEP_PX = 40;

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribeSettings(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SETTINGS_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SETTINGS_CHANGED, onChange);
  };
}

/** Saves a side-by-side setting in this browser; null clears it back to its default. */
function saveSetting(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage is off; the setting lasts until the page reloads.
  }
  window.dispatchEvent(new Event(SETTINGS_CHANGED));
}

const saveWidths = (widths: number[] | null) => saveSetting(WIDTHS_KEY, widths && JSON.stringify(widths));

/** The grid's columns for three offices, or for the offices and the calls feed. */
const template = (w: readonly number[], n: 3 | 4) => w.slice(0, n).map((x, i) => `minmax(${i === 3 ? `${MIN_PX[3]}px` : "0"}, ${x}fr)`).join(" ");
const gridVars = (w: readonly number[]) => ({ "--sbs-3": template(w, 3), "--sbs-4": template(w, 4) });

/** The saved column widths, in this browser, or the defaults. */
function useWidths() {
  const raw = useSyncExternalStore(subscribeSettings, () => readSetting(WIDTHS_KEY), () => null);
  return parseWeights(raw, DEFAULT_WIDTHS.length) ?? DEFAULT_WIDTHS;
}

/** Whether the third column shows the governors or the toss-ups, as last chosen in this browser. */
function useThird(): Third {
  const saved = useSyncExternalStore(subscribeSettings, () => readSetting(THIRD_KEY), () => null);
  return THIRDS.find((t) => t === saved) ?? "governor";
}

const HOUSE_KEY = "mt-sbs-house";

/** What the second column shows, as last chosen in this browser: the House, a second Senate map, or nothing (more room for the rest). */
type Second = "house" | "senate" | "off";
function useSecond(): Second {
  const saved = useSyncExternalStore(subscribeSettings, () => readSetting(HOUSE_KEY), () => null);
  return saved === "off" || saved === "senate" ? saved : "house";
}

/** The second column's switch: the House, a second Senate map (zoomed on its own), or hidden. */
function SecondSwitch({ second }: { second: Second }) {
  const set = (v: Second) => saveSetting(HOUSE_KEY, v === "house" ? null : v);
  return (
    <div className="mt-seg" role="group" aria-label="Second column shows">
      <button type="button" aria-pressed={second === "house"} onClick={() => set("house")}>House</button>
      <button type="button" aria-pressed={second === "senate"} onClick={() => set("senate")}>Senate</button>
      <button type="button" aria-pressed={false} onClick={() => set("off")} title="Hide this column, giving the others its room">Hide</button>
    </div>
  );
}

/** From the Senate column's heading, once the second column is hidden: brings it back. */
function ShowSecond() {
  return (
    <button type="button" className="mt-el-quiet small mt-sbs-house" onClick={() => saveSetting(HOUSE_KEY, null)} title="Show the second column again">
      Show House
    </button>
  );
}

/** The switch in the third column's heading between the governors and the toss-ups. */
function ThirdSwitch({ third }: { third: Third }) {
  return (
    <div className="mt-seg" role="group" aria-label="Third column shows">
      {THIRDS.map((t) => (
        <button key={t} type="button" aria-pressed={third === t} onClick={() => saveSetting(THIRD_KEY, t === "governor" ? null : t)}>
          {THIRD_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

/**
 * Toss-ups as cards with the top two candidates: the House's, or with the House column hidden (`noHouse`) the
 * Senate's and the governors' followed by their closest leans that are counting. Toss-ups with results come first
 * (counting, then called, in watchFirst order) and are always up; the rest only fill the space left. When the ones
 * with results don't all fit, they rotate among themselves; a page of races with no results never comes up.
 */
function TossupColumn({ data, star, handle, toggle, noHouse = false, senate = false }: { data: Overview; star: Star; handle: ReactNode; toggle: ReactNode; noHouse?: boolean; senate?: boolean }) {
  const { races, fixed } = useMemo(() => {
    const offices: readonly string[] = senate ? ["senate"] : noHouse ? ["senate", "governor"] : ["house"];
    const mine = data.races.filter((r) => offices.includes(r.office));
    // The Senate view takes every Senate race (closest first), not just its toss-ups.
    const all = mine.filter((r) => senate || r.rating === "tossup").sort(watchFirst);
    const counting = all.filter((r) => r.total > 0 && !isCalled(r));
    const called = all.filter(isCalled);
    const waiting = all.filter((r) => r.total === 0 && !isCalled(r));
    // With the House hidden there's room for the races next closest: leans still counting, closest first.
    const leans = noHouse && !senate ? mine.filter((r) => r.rating?.startsWith("lean") && r.total > 0 && !isCalled(r)).sort(watchFirst) : [];
    // The Senate view pins only the races still counting; its many called ones take turns with the rest.
    return { races: [...counting, ...called, ...leans, ...waiting], fixed: senate ? counting.length : counting.length + called.length };
  }, [data, noHouse, senate]);
  const cards = useRef<HTMLUListElement>(null);
  useRotatingFit(cards, undefined, true, fixed);
  return (
    <section className="mt-sbs-col" aria-label="Toss-up races" data-panel="tossups">
      <div className="mt-section-head tight">
        <h2>{senate ? "Senate races" : noHouse ? "Senate & governor toss-ups" : "House toss-ups"}</h2>
        <span className="muted small mt-sbs-count">{count(races.length)}</span>
        {toggle}
      </div>
      {races.length ? (
        <ul className="mt-grid mt-sbs-cards" ref={cards}>
          {races.map((r) => (
            <RaceCard key={r.id} race={r} starred={star.ids ? star.ids.includes(r.id) : null} onStar={star.toggle} limit={2} />
          ))}
        </ul>
      ) : (
        <p className="mt-empty small">No race is rated a toss-up right now.</p>
      )}
      {handle}
    </section>
  );
}

/**
 * A draggable divider at the right edge of column `i`. A drag writes the widths straight onto the grid, so the
 * columns (the House list holds 435 races) don't redraw on every move, and saves them when it ends. Arrow keys
 * move it too, and a double-click puts the columns back to their default widths.
 */
function ColumnHandle({ i, label, grid, widths }: { i: number; label: string; grid: RefObject<HTMLDivElement | null>; widths: number[] }) {
  const drag = useRef<{ x: number; from: number[]; width: number; n: number; now: number[] } | null>(null);
  // How many columns are side by side right now (3, or 4 with the calls feed) and the width they share.
  const measure = () => {
    const el = grid.current!;
    const style = getComputedStyle(el);
    const n = style.gridTemplateColumns.split(" ").length;
    return { n, width: el.clientWidth - (parseFloat(style.columnGap) || 0) * (n - 1) };
  };
  const apply = (w: number[]) => Object.entries(gridVars(w)).forEach(([k, v]) => grid.current?.style.setProperty(k, v));
  return (
    <div
      className={`mt-sbs-resize${i === 2 ? " to-side" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title="Drag to resize; double-click to reset"
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const { n, width } = measure();
        drag.current = { x: e.clientX, from: widths, width, n, now: widths };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.now = [...resize(d.from.slice(0, d.n), i, e.clientX - d.x, d.width, MIN_PX), ...d.from.slice(d.n)];
        apply(d.now);
      }}
      onPointerUp={() => {
        if (drag.current) saveWidths(drag.current.now);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
        apply(widths);
      }}
      onDoubleClick={() => saveWidths(null)}
      onKeyDown={(e: KeyboardEvent) => {
        const step = e.key === "ArrowLeft" ? -KEY_STEP_PX : e.key === "ArrowRight" ? KEY_STEP_PX : 0;
        if (!step) return;
        e.preventDefault();
        const { n, width } = measure();
        saveWidths([...resize(widths.slice(0, n), i, step, width, MIN_PX), ...widths.slice(n)]);
      }}
    />
  );
}

/**
 * Keeps `--sbs-top` on the grid at how far down the page it starts, so on wide screens the columns fill the rest of
 * the window (midterms.css) and their lists scroll inside them instead of the page scrolling.
 */
function useFitWindow(grid: RefObject<HTMLDivElement | null>, ready: boolean) {
  useEffect(() => {
    const el = grid.current;
    if (!ready || !el) return;
    const fit = () => el.style.setProperty("--sbs-top", `${el.getBoundingClientRect().top + window.scrollY}px`);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [grid, ready]);
}

/** Whether the browser is full screen: the window filling the screen (F11, or macOS's full screen) or a page's own. */
function isFullScreen(): boolean {
  return !!document.fullscreenElement || matchMedia("(display-mode: fullscreen)").matches || (window.innerWidth >= screen.width - 1 && window.innerHeight >= screen.height - 1);
}

/**
 * Full screen, the site header tucks away until the pointer reaches the top edge (midterms.css), so the columns get
 * its height. Marked on <html> while this page shows.
 */
function useFullScreenHeader() {
  useEffect(() => {
    const root = document.documentElement;
    const check = () => {
      const full = isFullScreen();
      if (full === (root.dataset.full === "1")) return;
      if (full) root.dataset.full = "1";
      else delete root.dataset.full;
      // The columns' height follows where they start (useFitWindow), which just moved.
      window.dispatchEvent(new Event("resize"));
    };
    check();
    window.addEventListener("resize", check);
    document.addEventListener("fullscreenchange", check);
    return () => {
      window.removeEventListener("resize", check);
      document.removeEventListener("fullscreenchange", check);
      delete root.dataset.full;
    };
  }, []);
}

/** Senate, House and Governor dashboards in columns for wide and ultrawide screens, sharing one live feed. */
export function SideBySide() {
  const { data, error } = useLive<Overview>("/api/midterms");
  const forecast = useLive<ForecastOverview>("/api/midterms/forecast").data;
  const favorites = useStars();
  const results = showsResults(useClock(60_000));
  const star: Star = { ids: favorites.ids, toggle: favorites.toggle };
  const widths = useWidths();
  const grid = useRef<HTMLDivElement>(null);
  useFitWindow(grid, Boolean(data));
  useFullScreenHeader();
  // No title row, so the columns get the height; the live status sits in the first column's heading.
  const status = data && (
    <span className="mt-sbs-status">
      <LiveDot at={data.fetchedAt} stale={data.stale} /> Checked <CheckedAgo at={data.fetchedAt} />
      {data.stale && " · source is slow"}
      <MomentPopup data={data} />
    </span>
  );
  const third = useThird();
  const second = useSecond();
  const showHouse = second === "house";
  const next = ["House", THIRD_LABEL[third], "the calls feed"];

  return (
    <div className="wrap mt mt-sbs-page">
      <ModeNav current="/midterms/side-by-side" />
      <h1 className="mt-sr">Senate, House and governors side by side</h1>
      <p className="muted small mt-sbs-note">Made for wide screens: widen the window, or open this on a large or ultrawide monitor, to see all three offices at once.</p>
      {error && <p className="error">{data ? `${error} Showing the last results we got.` : error}</p>}
      {!data && !error && <ColumnsSkeleton />}
      {/* Each column's seat bar shows who controls its chamber, so the page counts as showing control. */}
      {data && (
        <div ref={grid} className={`mt-sbs mt-in${second === "off" ? " no-house" : ""}`} style={gridVars(widths) as CSSProperties} data-panel="control">
          {COLUMNS.map((column, i) => {
            if (column.office === "house" && second === "off") return null;
            // The second column can be another Senate map, and the third one too: each zooms on its own.
            const c = (column.office === "house" && second === "senate") || (column.office === "governor" && third === "senatemap") ? { ...COLUMNS[0], slot: i } : { ...column, slot: i };
            const handle = <ColumnHandle i={i} label={`Resize ${i === 2 ? next[1] : c.title} and ${next[i]}`} grid={grid} widths={widths} />;
            const thirdSlot = column.office === "governor";
            // The third column can swap the governors for the toss-ups; the switch sits in its heading either way.
            if (thirdSlot && third === "tossups") return <TossupColumn key="tossups" data={data} star={star} handle={handle} toggle={<ThirdSwitch third={third} />} noHouse={!showHouse} />;
            if (thirdSlot && third === "senate") return <TossupColumn key="senate-cards" data={data} star={star} handle={handle} toggle={<ThirdSwitch third={third} />} senate />;
            if (thirdSlot && third === "calls") {
              return (
                <section key="calls" className="mt-sbs-col mt-sbs-calls" aria-label="Latest calls" data-panel="calls">
                  {/* The calls feed carries its own heading; this row holds just the switch. */}
                  <div className="mt-section-head tight">
                    <ThirdSwitch third={third} />
                  </div>
                  <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office="all" fill />
                  {handle}
                </section>
              );
            }
            // The second column's heading switches it (House, Senate, hidden); once hidden, the first column's heading brings it back.
            const toggle = thirdSlot ? <ThirdSwitch third={third} /> : i === 1 ? <SecondSwitch second={second} /> : second === "off" ? <ShowSecond /> : undefined;
            const { slot, ...props } = c;
            return <OfficeColumn key={`${slot}-${c.office}`} {...props} data={data} forecast={forecast} results={results} star={star} status={i === 0 ? status : undefined} handle={handle} toggle={toggle} />;
          })}
          <aside className="mt-sbs-side" aria-label="Latest calls and poll closings">
            <CallsFeed races={data.races} events={data.callEvents} counts={data.callEventCounts} office="all" fill />
            <PollSchedule races={data.races} picked={[]} onPick={() => {}} />
          </aside>
        </div>
      )}
      <p className="muted small mt-source"><Link href="/midterms/credits">Sources and credits</Link></p>
    </div>
  );
}
