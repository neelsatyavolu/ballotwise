// Rendered inside the tracker's client components.
import { useEffect, useState, type ReactNode } from "react";

type StateMap = { state: string; name: string; viewBox: string; outline: string; counties: { fips: string; name: string; d: string }[] };
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

function MapFrame({ viewBox, children, tip, label }: { viewBox: string; children: ReactNode; tip: Tip; label: string }) {
  return (
    <div className="mt-map">
      <svg viewBox={viewBox} role="img" aria-label={label}>
        {children}
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

export type CountyFill = { fill: string; tip: ReactNode; active: boolean };

/** A state's counties. Counties without a fill (outside a House district, say) are drawn faint. */
export function CountyMap({ state, fills, selected, onSelect }: { state: string; fills: Map<string, CountyFill>; selected: string | null; onSelect: (fips: string | null) => void }) {
  const map = useMap<StateMap>(state);
  const [tip, setTip] = useState<Tip>(null);
  if (map === "error") return <p className="muted small">The map couldn&apos;t load. The table below has every county.</p>;
  if (!map) return <div className="mt-map mt-map-loading" aria-busy />;
  return (
    <MapFrame viewBox={map.viewBox} tip={tip} label={`County map of ${map.name}`}>
      <path d={map.outline} className="mt-outline" />
      {map.counties.map((c) => {
        const f = fills.get(c.fips);
        return (
          <path
            key={c.fips}
            d={c.d}
            className={`mt-county${f?.active ? " active" : ""}${selected === c.fips ? " selected" : ""}`}
            style={{ fill: f?.fill }}
            onPointerMove={(e) => f && setTip({ ...tipAt(e), content: f.tip })}
            onPointerLeave={() => setTip(null)}
            onClick={() => f?.active && onSelect(selected === c.fips ? null : c.fips)}
          />
        );
      })}
    </MapFrame>
  );
}

/** The nation by state, for Senate and Governor overviews. Clicking a state opens its race. */
export function NationMap({ fills, onPick, label }: { fills: Map<string, { fill: string; tip: ReactNode }>; onPick: (state: string) => void; label: string }) {
  const map = useMap<NationMap>("US");
  const [tip, setTip] = useState<Tip>(null);
  if (map === "error") return null;
  if (!map) return <div className="mt-map mt-map-loading nation" aria-busy />;
  return (
    <MapFrame viewBox={map.viewBox} tip={tip} label={label}>
      {map.states.map((s) => {
        const f = fills.get(s.state);
        return (
          <path
            key={s.state}
            d={s.d}
            className={`mt-county${f ? " active" : ""}`}
            style={{ fill: f?.fill }}
            onPointerMove={(e) => setTip({ ...tipAt(e), content: f?.tip ?? <b>{s.name}</b> })}
            onPointerLeave={() => setTip(null)}
            onClick={() => f && onPick(s.state)}
          />
        );
      })}
      <path d={map.borders} className="mt-borders" />
    </MapFrame>
  );
}
