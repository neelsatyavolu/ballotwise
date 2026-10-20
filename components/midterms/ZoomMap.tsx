// Rendered inside OfficeView.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CityLabels, type City } from "./maps";

type Nation = { viewBox: string; borders: string; states: { state: string; name: string; d: string; box: [number, number, number, number] }[] };
type Layer = { counties: { fips: string; name: string; d: string }[]; cities?: City[] };
type Box = [number, number, number, number]; // x, y, width, height
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
const ZOOM_MS = 450;

/** The state's bounds padded on every side, so a small state like Rhode Island still has context around it. */
function framed([x0, y0, x1, y1]: [number, number, number, number]): Box {
  const w = x1 - x0;
  const h = y1 - y0;
  const pad = Math.max(w, h) * 0.12 + 4;
  return [x0 - pad, y0 - pad, w + pad * 2, h + pad * 2];
}

/** Bounds of SVG paths written as absolute x,y pairs, as d3-geo writes them. */
function boundsOf(paths: string[]): [number, number, number, number] | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const d of paths) {
    for (const [, xs, ys] of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
      const x = Number(xs);
      const y = Number(ys);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

/**
 * Where to zoom for a race inside a state. A district that covers only part of a big state gets its own closer
 * view; a statewide race, or a district that fills most of its state, keeps the state view.
 */
function raceBounds(state: [number, number, number, number], race: [number, number, number, number]): [number, number, number, number] {
  const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
  if (area(race) > area(state) * 0.4) return state;
  // Keep some of the state around a one-county district, so it doesn't fill the map with no context.
  const min = Math.max(state[2] - state[0], state[3] - state[1]) * 0.22;
  const grow = (lo: number, hi: number): [number, number] => {
    const extra = Math.max(0, min - (hi - lo)) / 2;
    return [lo - extra, hi + extra];
  };
  const [x0, x1] = grow(race[0], race[2]);
  const [y0, y1] = grow(race[1], race[3]);
  return [x0, y0, x1, y1];
}

/** Animates between two view boxes; the SVG letterboxes to keep the aspect. */
function useTween(target: Box): Box {
  const [box, setBox] = useState<Box>(target);
  const from = useRef<Box>(target);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ZOOM_MS);
      const e = 1 - (1 - t) ** 3;
      const next = origin.map((v, i) => v + (target[i] - v) * e) as Box;
      from.current = next;
      setBox(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return box;
}

/**
 * The nation by state; picking a state zooms to it and draws its counties, shaded by `countyFills`.
 * States without a fill have no race of this kind and can't be picked.
 */
export function ZoomMap({ fills, focus, onFocus, countyFills, label }: {
  fills: Map<string, Fill>;
  focus: string | null;
  onFocus: (state: string | null) => void;
  /** Undefined while the picked race is still loading: the map holds its view instead of zooming out and back. */
  countyFills: Map<string, Fill> | null | undefined;
  label: string;
}) {
  const [nation, setNation] = useState<Nation | null | "error">(null);
  const [layer, setLayer] = useState<{ state: string; data: Layer } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  // Outlines are drawn in a layer above every shape, so neighbors can't cover part of them.
  const [hover, setHover] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

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

  const counties = focus && layer?.state === focus ? layer.data.counties : null;
  // Null while the picked race loads; the last view is held so the map doesn't zoom out and back.
  const focused = nation && nation !== "error" ? nation.states.find((s) => s.state === focus) : undefined;
  const live = useMemo<Box | null>(() => {
    if (!focused) return FULL;
    if (countyFills === undefined) return null;
    const inRace = counties && countyFills ? boundsOf(counties.filter((c) => countyFills.has(c.fips)).map((c) => c.d)) : null;
    return framed(inRace ? raceBounds(focused.box, inRace) : focused.box);
  }, [focused, counties, countyFills]);
  const [kept, setKept] = useState<{ focus: string | null; box: Box }>({ focus, box: live ?? FULL });
  if (live && (kept.box !== live || kept.focus !== focus)) setKept({ focus, box: live });
  const target = live ?? (kept.focus === focus ? kept.box : framed(focused!.box));
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
      {focus && (
        <button type="button" className="mt-zoom-back" onClick={() => onFocus(null)}>
          ← All states
        </button>
      )}
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
                if (counties) return;
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
        {counties?.map((c) => {
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
            />
          );
        })}
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
