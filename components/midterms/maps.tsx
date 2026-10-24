// Rendered inside the tracker's client components.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { atLeast, boundsOf, framed, useTween, type Box } from "./zoom";

export type City = { name: string; at: [number, number] };
type StateMap = { state: string; name: string; viewBox: string; outline: string; counties: { fips: string; name: string; d: string }[]; cities?: City[] };
type NationMap = { viewBox: string; borders: string; states: { state: string; name: string; d: string }[] };

const loaded = new Map<string, Promise<unknown>>();

/** Loads a pre-projected map from public/midterms/maps (built by scripts/build-maps.mjs), once per page. */
function useMap<T>(name: string): T | null | "error" {
  const [map, setMap] = useState<T | null | "error">(null);
  useEffect(() => {
    let live = true;
    if (!loaded.has(name)) loaded.set(name, fetch(`/midterms/maps/${name}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))));
    loaded
      .get(name)!
      .then((m) => live && setMap(m as T))
      .catch(() => {
        loaded.delete(name);
        if (live) setMap("error");
      });
    return () => {
      live = false;
    };
  }, [name]);
  return map;
}

type Tip = { x: number; y: number; content: ReactNode } | null;

/** `outlines` are drawn above every shape, so neighbors can't cover part of a hovered or selected border. */
/** `aspect` holds the map's shape while its view box zooms. */
function MapFrame({ viewBox, children, tip, label, outlines, back, aspect }: { viewBox: string; children: ReactNode; tip: Tip; label: string; outlines: { d: string; kind: "hover" | "selected" }[]; back?: ReactNode; aspect?: string }) {
  return (
    <div className="mt-map">
      {back}
      <svg viewBox={viewBox} role="img" aria-label={label} style={aspect ? { aspectRatio: aspect } : undefined}>
        {children}
        {outlines.map((o, i) => (
          <path key={`${o.kind}${i}`} d={o.d} className={`mt-line ${o.kind}`} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {tip && (
        <div className="mt-tip" style={{ left: tip.x, top: tip.y }} role="status">
          {tip.content}
        </div>
      )}
    </div>
  );
}

/** Tooltip position relative to the map box, from a pointer event on one of its shapes. */
function tipAt(e: React.PointerEvent<SVGElement>) {
  const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).parentElement!.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

const MAX_LABELS = 8;
const LABEL_PX = 11;
/** Screen pixels between city dots, so suburbs don't crowd out the city they ring. */
const DOT_GAP = 30;
type Placed = City & { left: boolean };

/**
 * The biggest cities whose labels fit in `view` without overlapping, largest first. A label goes right of its dot,
 * or left when the right side is taken or off the map. Sizes are in screen pixels times `unit`.
 */
function placeCities(cities: readonly City[], unit: number, [vx, vy, vw, vh]: readonly number[]): Placed[] {
  const boxes: number[][] = [];
  const placed: Placed[] = [];
  const free = (b: number[]) => b[0] >= vx && b[2] <= vx + vw && b[1] >= vy && b[3] <= vy + vh && boxes.every((o) => b[0] > o[2] || b[2] < o[0] || b[1] > o[3] || b[3] < o[1]);
  for (const c of cities) {
    if (placed.length >= MAX_LABELS) break;
    const [x, y] = c.at;
    if (placed.some((p) => Math.hypot(p.at[0] - x, p.at[1] - y) < DOT_GAP * unit)) continue;
    // Semibold 11px averages about 6.4px a character; a few pixels of gap keep neighbors readable.
    const w = (c.name.length * 6.4 + 8) * unit;
    const h = (LABEL_PX / 2 + 1.5) * unit;
    const right = [x - 3 * unit, y - h, x + w, y + h];
    const left = [x - w, y - h, x + 3 * unit, y + h];
    const side = free(right) ? right : free(left) ? left : null;
    if (!side) continue;
    boxes.push(side);
    placed.push({ ...c, left: side === left });
  }
  return placed;
}

/**
 * Dots and names for a state's big cities, sized in screen pixels. `view` is the map's view box; the labels measure
 * the drawn SVG to know how many map units a pixel is, so they keep their size at any zoom or screen width.
 */
export function CityLabels({ cities, view }: { cities: readonly City[]; view: readonly number[] }) {
  const group = useRef<SVGGElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useEffect(() => {
    const svg = group.current?.ownerSVGElement;
    if (!svg) return;
    const watch = new ResizeObserver(() => setSize([svg.clientWidth, svg.clientHeight]));
    watch.observe(svg);
    return () => watch.disconnect();
  }, []);
  // The SVG letterboxes, so the tighter of the two axes sets the scale.
  const unit = size && size[0] && size[1] ? Math.max(view[2] / size[0], view[3] / size[1]) : 0;
  const placed = useMemo(() => (unit ? placeCities(cities, unit, view) : []), [cities, unit, view]);
  return (
    <g ref={group} className="mt-cities" aria-hidden style={{ fontSize: LABEL_PX * unit, strokeWidth: 3 * unit }}>
      {placed.map((c) => (
        <g key={c.name}>
          <circle cx={c.at[0]} cy={c.at[1]} r={2.5 * unit} strokeWidth={1.2 * unit} />
          <text x={c.at[0] + (c.left ? -5 : 5) * unit} y={c.at[1]} dy="0.35em" textAnchor={c.left ? "end" : "start"}>
            {c.name}
          </text>
        </g>
      ))}
    </g>
  );
}

export type CountyFill = { fill: string; tip: ReactNode; active: boolean };

/** A state's counties. Counties without a fill (outside a House district, say) are drawn faint. The selected county is zoomed to. */
export function CountyMap({ state, fills, selected, onSelect }: { state: string; fills: Map<string, CountyFill>; selected: string | null; onSelect: (fips: string | null) => void }) {
  const map = useMap<StateMap>(state);
  const [tip, setTip] = useState<Tip>(null);
  const [hover, setHover] = useState<string | null>(null);
  const ready = map && map !== "error" ? map : null;
  const selectedPath = ready?.counties.find((c) => c.fips === selected)?.d;
  const full = useMemo(() => (ready?.viewBox ?? "0 0 640 440").split(" ").map(Number) as Box, [ready]);
  const target = useMemo<Box>(() => {
    const b = selectedPath && boundsOf([selectedPath]);
    return b ? framed(atLeast(b, [full[0], full[1], full[0] + full[2], full[1] + full[3]], 0.2)) : full;
  }, [full, selectedPath]);
  const box = useTween(target);
  if (map === "error") return <p className="muted small">The map couldn&apos;t load. The table below has every county.</p>;
  if (!map) return <div className="mt-map mt-map-loading" aria-busy />;
  const outlines = [...(selectedPath ? [{ d: selectedPath, kind: "selected" as const }] : []), ...(hover ? [{ d: hover, kind: "hover" as const }] : [])];
  return (
    <MapFrame
      viewBox={box.join(" ")}
      tip={tip}
      label={`County map of ${map.name}`}
      outlines={outlines}
      aspect={`${full[2]} / ${full[3]}`}
      back={
        selectedPath && (
          <button type="button" className="mt-zoom-back" onClick={() => onSelect(null)}>
            ← All of {map.name}
          </button>
        )
      }
    >
      <path d={map.outline} className="mt-outline" vectorEffect="non-scaling-stroke" />
      {map.counties.map((c) => {
        const f = fills.get(c.fips);
        return (
          <path
            key={c.fips}
            d={c.d}
            vectorEffect="non-scaling-stroke"
            className={`mt-county${f?.active ? " active" : ""}`}
            style={{ fill: f?.fill }}
            onPointerMove={(e) => {
              if (!f) return;
              setTip({ ...tipAt(e), content: f.tip });
              setHover(c.d);
            }}
            onPointerLeave={() => {
              setTip(null);
              setHover(null);
            }}
            onClick={() => f?.active && onSelect(selected === c.fips ? null : c.fips)}
          />
        );
      })}
      {map.cities && <CityLabels cities={map.cities} view={target} />}
    </MapFrame>
  );
}

/**
 * The nation by state, for Senate and Governor overviews. Clicking a state, or focusing it and pressing Enter, picks it.
 * `label` on a fill names the state's status for screen readers; `selected` states get a heavier outline.
 */
export function NationMap({ fills, onPick, label, selected = [] }: { fills: Map<string, { fill: string; tip: ReactNode; label?: string }>; onPick: (state: string) => void; label: string; selected?: readonly string[] }) {
  const map = useMap<NationMap>("US");
  const [tip, setTip] = useState<Tip>(null);
  const [hover, setHover] = useState<string | null>(null);
  if (map === "error") return null;
  if (!map) return <div className="mt-map mt-map-loading nation" aria-busy />;
  const outlines = [
    ...map.states.filter((s) => selected.includes(s.state)).map((s) => ({ d: s.d, kind: "selected" as const })),
    ...(hover ? [{ d: hover, kind: "hover" as const }] : []),
  ];
  return (
    <MapFrame viewBox={map.viewBox} tip={tip} label={label} outlines={outlines}>
      {map.states.map((s) => {
        const f = fills.get(s.state);
        return (
          <path
            key={s.state}
            d={s.d}
            className={`mt-county${f ? " active" : ""}`}
            style={{ fill: f?.fill }}
            tabIndex={f ? 0 : undefined}
            role={f ? "button" : undefined}
            aria-label={f ? `${s.name}${f.label ? `: ${f.label}` : ""}` : undefined}
            aria-pressed={f ? selected.includes(s.state) : undefined}
            onPointerMove={(e) => {
              setTip({ ...tipAt(e), content: f?.tip ?? <b>{s.name}</b> });
              setHover(f ? s.d : null);
            }}
            onPointerLeave={() => {
              setTip(null);
              setHover(null);
            }}
            onFocus={() => setHover(f ? s.d : null)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (f && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onPick(s.state);
              }
            }}
            onClick={() => f && onPick(s.state)}
          />
        );
      })}
      <path d={map.borders} className="mt-borders" />
    </MapFrame>
  );
}
