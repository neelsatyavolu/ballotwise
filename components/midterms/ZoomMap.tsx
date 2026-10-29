// Rendered inside OfficeView.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CityLabels, type City } from "./maps";
import { atLeast, boundsOf, framed, useTween, type Bounds, type Box } from "./zoom";

type Nation = { viewBox: string; borders: string; states: { state: string; name: string; d: string; box: [number, number, number, number] }[] };
type Layer = { counties: { fips: string; name: string; d: string }[]; cities?: City[] };
type Districts = { districts: { district: number; d: string }[] };
export type Fill = { fill: string; tip: ReactNode };

const cache = new Map<string, Promise<unknown>>();
function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).catch((err) => {
        cache.delete(path);
        throw err;
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}

const FULL: Box = [0, 0, 975, 610];

/**
 * Where to zoom for a race inside a state. A district that covers only part of a big state gets its own closer
 * view; a statewide race, or a district that fills most of its state, keeps the state view.
 */
function raceBounds(state: Bounds, race: Bounds): Bounds {
  const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
  if (area(race) > area(state) * 0.4) return state;
  // Keep some of the state around a one-county district, so it doesn't fill the map with no context.
  return atLeast(race, state, 0.22);
}

/**
 * The nation by state; picking a state zooms to it and draws its counties, shaded by `countyFills`.
 * States without a fill have no race of this kind and can't be picked. Given `districtFills`, a state with no
 * county results on show draws its congressional districts instead, and picking one calls `onPickDistrict`.
 */
export function ZoomMap({ fills, focus, onFocus, countyFills, raceId, label, districtFills, district, onPickDistrict }: {
  fills: Map<string, Fill>;
  focus: string | null;
  onFocus: (state: string | null) => void;
  /** Undefined while the picked race is still loading: the map holds its view instead of zooming out and back. */
  countyFills: Map<string, Fill> | null | undefined;
  /** The race the counties belong to; a zoomed-in county lets go when it changes. */
  raceId: number | null;
  label: string;
  /** House districts by number, for the zoomed state. */
  districtFills?: Map<number, Fill>;
  /** The picked district, outlined and zoomed to. */
  district?: number | null;
  onPickDistrict?: (district: number) => void;
}) {
  const [nation, setNation] = useState<Nation | null | "error">(null);
  const [layer, setLayer] = useState<{ state: string; data: Layer } | null>(null);
  const [lines, setLines] = useState<{ state: string; data: Districts } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  // Outlines are drawn in a layer above every shape, so neighbors can't cover part of them.
  const [hover, setHover] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // A clicked county, zoomed to until it's clicked again or the state or race changes.
  const [zoomed, setZoomed] = useState<{ fips: string; focus: string; raceId: number | null } | null>(null);

  useEffect(() => {
    load<Nation>("/midterms/maps/US.json").then(setNation, () => setNation("error"));
  }, []);
  useEffect(() => {
    if (!focus) return;
    let live = true;
    load<Layer>(`/midterms/maps/albers/${focus}.json`).then(
      (data) => live && setLayer({ state: focus, data }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [focus]);
  const wantsDistricts = !!districtFills;
  useEffect(() => {
    if (!focus || !wantsDistricts) return;
    let live = true;
    load<Districts>(`/midterms/maps/districts/${focus}.json`).then(
      (data) => live && setLines({ state: focus, data }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [focus, wantsDistricts]);

  const counties = focus && layer?.state === focus ? layer.data.counties : null;
  const districts = districtFills && focus && lines?.state === focus ? lines.data.districts : null;
  // County results take over once a district's counties come in; until then, and in states that report by town, districts show.
  const showDistricts = districts && !countyFills?.size ? districts : null;
  const pickedDistrict = district != null ? districts?.find((d) => d.district === district) : undefined;
  // Null while the picked race loads; the last view is held so the map doesn't zoom out and back.
  const focused = nation && nation !== "error" ? nation.states.find((s) => s.state === focus) : undefined;
  const live = useMemo<Box | null>(() => {
    if (!focused) return FULL;
    const shape = pickedDistrict && boundsOf([pickedDistrict.d]);
    if (shape) return framed(raceBounds(focused.box, shape));
    if (countyFills === undefined) return null;
    const inRace = counties && countyFills ? boundsOf(counties.filter((c) => countyFills.has(c.fips)).map((c) => c.d)) : null;
    return framed(inRace ? raceBounds(focused.box, inRace) : focused.box);
  }, [focused, counties, countyFills, pickedDistrict]);
  const [kept, setKept] = useState<{ focus: string | null; box: Box }>({ focus, box: live ?? FULL });
  if (live && (kept.box !== live || kept.focus !== focus)) setKept({ focus, box: live });
  const county = zoomed && zoomed.focus === focus && zoomed.raceId === raceId ? counties?.find((c) => c.fips === zoomed.fips) : undefined;
  const countyBox = useMemo(() => {
    const b = county && focused && boundsOf([county.d]);
    return b ? framed(atLeast(b, focused.box, 0.15)) : null;
  }, [county, focused]);
  const target = countyBox ?? live ?? (kept.focus === focus ? kept.box : framed(focused!.box));
  const box = useTween(target);

  if (nation === "error") return <p className="muted small">The map couldn&apos;t load. The list has every race.</p>;
  if (!nation) return <div className="mt-map mt-map-loading nation" aria-busy />;

  const showTip = (e: React.PointerEvent, content: ReactNode) => {
    const r = wrap.current!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content });
  };
  const focusedPath = focused?.d;
  const cities = focus && layer?.state === focus ? layer.data.cities : undefined;

  return (
    <div className="mt-map mt-zoom" ref={wrap}>
      {focus &&
        (county ? (
          <button type="button" className="mt-zoom-back" onClick={() => setZoomed(null)}>
            ← All of {focused?.name ?? focus}
          </button>
        ) : (
          <button type="button" className="mt-zoom-back" onClick={() => onFocus(null)}>
            ← All states
          </button>
        ))}
      <svg viewBox={box.join(" ")} role="img" aria-label={label}>
        {nation.states.map((s) => {
          const f = fills.get(s.state);
          const dim = focus && s.state !== focus;
          return (
            <path
              key={s.state}
              d={s.d}
              vectorEffect="non-scaling-stroke"
              className={`mt-state${f ? " active" : ""}${dim ? " dim" : ""}`}
              style={{ fill: f?.fill }}
              onPointerMove={(e) => {
                if (counties || districts) return;
                showTip(e, f?.tip ?? <b>{s.name}</b>);
                setHover(f ? s.d : null);
              }}
              onPointerLeave={() => {
                setTip(null);
                setHover(null);
              }}
              onClick={() => f && onFocus(s.state === focus ? null : s.state)}
            />
          );
        })}
        <path d={nation.borders} className="mt-borders" vectorEffect="non-scaling-stroke" />
        {showDistricts?.map((d) => {
          const f = districtFills?.get(d.district);
          return (
            <path
              key={d.district}
              d={d.d}
              vectorEffect="non-scaling-stroke"
              className={`mt-zoom-county${f ? " active" : ""}`}
              style={{ fill: f?.fill }}
              onPointerMove={(e) => {
                showTip(e, f?.tip ?? <b>{focus}-{d.district || "AL"}</b>);
                setHover(d.d);
              }}
              onPointerLeave={() => {
                setTip(null);
                setHover(null);
              }}
              onClick={() => f && onPickDistrict?.(d.district)}
            />
          );
        })}
        {!showDistricts && counties?.map((c) => {
          const f = countyFills?.get(c.fips);
          return (
            <path
              key={c.fips}
              d={c.d}
              vectorEffect="non-scaling-stroke"
              className={`mt-zoom-county${f ? " active" : ""}`}
              style={{ fill: f?.fill }}
              onPointerMove={(e) => {
                showTip(e, f?.tip ?? <b>{c.name}</b>);
                setHover(c.d);
              }}
              onPointerLeave={() => {
                setTip(null);
                setHover(null);
              }}
              onClick={() => focus && setZoomed(county?.fips === c.fips ? null : { fips: c.fips, focus, raceId })}
            />
          );
        })}
        {county && <path d={county.d} className="mt-line selected" vectorEffect="non-scaling-stroke" />}
        {pickedDistrict && <path d={pickedDistrict.d} className="mt-line selected" vectorEffect="non-scaling-stroke" />}
        {focusedPath && <path d={focusedPath} className="mt-line focus" vectorEffect="non-scaling-stroke" />}
        {hover && <path d={hover} className="mt-line hover" vectorEffect="non-scaling-stroke" />}
        {/* Laid out for where the zoom is heading, so labels don't reshuffle on every frame. */}
        {cities && <CityLabels cities={cities} view={target} />}
      </svg>
      {tip && (
        <div className="mt-tip" style={{ left: tip.x, top: tip.y }} role="status">
          {tip.content}
        </div>
      )}
    </div>
  );
}
