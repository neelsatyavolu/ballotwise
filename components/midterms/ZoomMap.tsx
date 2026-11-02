// Rendered inside OfficeView.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { labelSpot } from "@/lib/midterms/labelSpot";
import { CityLabels, FlipStripes, loadMap, useDistrictShapes, usePatternId, type City } from "./maps";
import { HoverCard, keyOf, useMapHover } from "./mapHover";
import { atLeast, boundsOf, framed, useTween, type Bounds, type Box } from "./zoom";

type Nation = { viewBox: string; borders: string; states: { state: string; name: string; d: string; box: [number, number, number, number] }[] };
type Layer = { counties: { fips: string; name: string; d: string }[]; cities?: City[] };
/** The ring at the middle of a marked district, in map units (the national map is 975 wide). */
const MARK_RING = 16;
type Districts = { districts: { district: number; d: string }[] };
/** `flip` stripes a state or district projected to change party; `called` marks a state's label with a check. */
/** `watch` outlines a toss-up in yellow on election night, `lean` an uncalled lean in a thinner dashed yellow. */
export type Fill = { fill: string; tip: ReactNode; flip?: boolean; called?: boolean; watch?: boolean; lean?: boolean };

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
export function ZoomMap({ fills, focus, onFocus, countyFills, raceId, label, districtFills, district, onPickDistrict, nationDistricts, onPickNationDistrict, nationDistrict }: {
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
  /** Every House district, keyed "PA-7", drawn on the national view instead of whole states. */
  nationDistricts?: Map<string, Fill>;
  /** A district picked on the national view, by its key. */
  onPickNationDistrict?: (key: string) => void;
  /**
   * A district marked on the national view without zooming, by its key: outlined, with a ring at its middle so even a
   * small city district can be found from across a room.
   */
  nationDistrict?: string | null;
}) {
  const [nation, setNation] = useState<Nation | null | "error">(null);
  const [layer, setLayer] = useState<{ state: string; data: Layer } | null>(null);
  const [lines, setLines] = useState<{ state: string; data: Districts } | null>(null);
  const patternId = usePatternId();
  const wrap = useRef<HTMLDivElement>(null);
  const hover = useMapHover(wrap);
  // A clicked county, zoomed to until it's clicked again or the state or race changes.
  const [zoomed, setZoomed] = useState<{ fips: string; focus: string; raceId: number | null } | null>(null);

  useEffect(() => {
    loadMap<Nation>("US").then(setNation, () => setNation("error"));
  }, []);
  useEffect(() => {
    if (!focus) return;
    let live = true;
    loadMap<Layer>(`albers/${focus}`).then(
      (data) => live && setLayer({ state: focus, data }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [focus]);
  const wantsDistricts = !!districtFills;
  const nationStates = useMemo(() => (nationDistricts ? [...new Set([...nationDistricts.keys()].map((k) => k.split("-")[0]))].sort() : null), [nationDistricts]);
  const allDistricts = useDistrictShapes(nationStates);
  const labels = useMemo(
    () => (nation && nation !== "error" ? nation.states.filter((s) => fills.has(s.state)).flatMap((s) => {
      const at = labelSpot(s.state, s.d);
      return at ? [{ state: s.state, at, called: !!fills.get(s.state)?.called }] : [];
    }) : []),
    [nation, fills],
  );
  useEffect(() => {
    if (!focus || !wantsDistricts) return;
    let live = true;
    loadMap<Districts>(`districts/${focus}`).then(
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

  const nat = nation && nation !== "error" ? nation : null;
  const cities = focus && layer?.state === focus ? layer.data.cities : undefined;
  const byState = useMemo(() => new Map(nat?.states.map((st) => [st.state, st]) ?? []), [nat]);
  const byNationDistrict = useMemo(() => new Map(allDistricts?.map((d) => [d.key, d]) ?? []), [allDistricts]);
  const marked = !focus && nationDistrict ? byNationDistrict.get(nationDistrict) : undefined;
  const markedAt = useMemo(() => {
    const b = marked && boundsOf([marked.d]);
    return b ? { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 } : null;
  }, [marked]);
  const byDistrict = useMemo(() => new Map(districts?.map((d) => [d.district, d]) ?? []), [districts]);
  const byCounty = useMemo(() => new Map(counties?.map((c) => [c.fips, c]) ?? []), [counties]);

  // The shapes are drawn once per change to the data, not on every frame of a zoom or every hover: each layer below
  // is memoized, and pointer events are handled once on the <svg> by the `data-k` key of the shape under the pointer
  // ("s:PA" a state, "n:PA-7" a district on the national view, "d:7" a district in the zoomed state, "c:42003" a county).
  const stateLayer = useMemo(
    () =>
      nat && (
        <>
          {nat.states.map((st) => {
            const f = fills.get(st.state);
            const dim = focus && st.state !== focus;
            return <path key={st.state} data-k={`s:${st.state}`} d={st.d} vectorEffect="non-scaling-stroke" className={`mt-state${f ? " active" : ""}${dim ? " dim" : ""}`} style={{ fill: f?.fill }} />;
          })}
          {nat.states.map((st) => fills.get(st.state)?.flip && <path key={`flip-${st.state}`} d={st.d} className="mt-flip" style={{ fill: `url(#${patternId})` }} />)}
          <path d={nat.borders} className="mt-borders" vectorEffect="non-scaling-stroke" />
        </>
      ),
    [nat, fills, focus, patternId],
  );
  const nationDistrictLayer = useMemo(
    () =>
      nat && !focus && nationDistricts && (
        <>
          {allDistricts?.map((d) => {
            const f = nationDistricts.get(d.key);
            return <path key={d.key} data-k={`n:${d.key}`} d={d.d} vectorEffect="non-scaling-stroke" className={`mt-nation-district${f ? " active" : ""}`} style={{ fill: f?.fill }} />;
          })}
          {allDistricts?.map((d) => nationDistricts.get(d.key)?.flip && <path key={`flip-${d.key}`} d={d.d} className="mt-flip" style={{ fill: `url(#${patternId})` }} />)}
          <path d={nat.borders} className="mt-borders strong" vectorEffect="non-scaling-stroke" />
        </>
      ),
    [nat, focus, nationDistricts, allDistricts, patternId],
  );
  const placeLayer = useMemo(
    () =>
      showDistricts ? (
        <>
          {showDistricts.map((d) => {
            const f = districtFills?.get(d.district);
            return <path key={d.district} data-k={`d:${d.district}`} d={d.d} vectorEffect="non-scaling-stroke" className={`mt-zoom-county${f ? " active" : ""}`} style={{ fill: f?.fill }} />;
          })}
          {showDistricts.map((d) => districtFills?.get(d.district)?.flip && <path key={`flip-${d.district}`} d={d.d} className="mt-flip" style={{ fill: `url(#${patternId})` }} />)}
        </>
      ) : (
        counties?.map((c) => {
          const f = countyFills?.get(c.fips);
          return <path key={c.fips} data-k={`c:${c.fips}`} d={c.d} vectorEffect="non-scaling-stroke" className={`mt-zoom-county${f ? " active" : ""}`} style={{ fill: f?.fill }} />;
        })
      ),
    [showDistricts, districtFills, counties, countyFills, patternId],
  );
  // Election night: pre-election toss-ups get a yellow outline, called or not, and uncalled leans a thinner dashed
  // one. Leans go first so a toss-up's outline sits on top where they meet.
  const watchLayer = useMemo(() => {
    const outline = (kind: "lean" | "watch") => {
      const cls = kind === "lean" ? "mt-watch lean" : "mt-watch";
      return (
        <>
          {nat && !focus && !nationDistricts && nat.states.map((st) => fills.get(st.state)?.[kind] && <path key={`${kind}-${st.state}`} d={st.d} className={cls} vectorEffect="non-scaling-stroke" />)}
          {!focus && nationDistricts && allDistricts?.map((d) => nationDistricts.get(d.key)?.[kind] && <path key={`${kind}-${d.key}`} d={d.d} className={cls} vectorEffect="non-scaling-stroke" />)}
          {showDistricts?.map((d) => districtFills?.get(d.district)?.[kind] && <path key={`${kind}-d${d.district}`} d={d.d} className={cls} vectorEffect="non-scaling-stroke" />)}
        </>
      );
    };
    return (
      <>
        {outline("lean")}
        {outline("watch")}
      </>
    );
  }, [nat, focus, nationDistricts, allDistricts, showDistricts, districtFills, fills]);
  const labelLayer = useMemo(
    () =>
      !focus &&
      labels.map((l) => (
        <text key={l.state} x={l.at[0]} y={l.at[1]} className="mt-state-label" textAnchor="middle" dominantBaseline="central" aria-hidden>
          {l.state}
          {l.called && <tspan className="mt-state-check"> ✓</tspan>}
        </text>
      )),
    [focus, labels],
  );

  if (nation === "error") return <p className="muted small">The map couldn&apos;t load. The list has every race.</p>;
  if (!nat) return <div className="mt-map mt-map-loading nation" aria-busy />;

  /** The hover card and outline for a shape's key, or null when it has none (a state under a zoomed-in one). */
  const hit = (k: string): { d: string | null; tip: ReactNode } | null => {
    const id = k.slice(2);
    if (k.startsWith("s:")) {
      const st = byState.get(id);
      if (!st || counties || districts) return null;
      const f = fills.get(id);
      return { d: f ? st.d : null, tip: f?.tip ?? <b>{st.name}</b> };
    }
    if (k.startsWith("n:")) {
      const d = byNationDistrict.get(id);
      return d ? { d: d.d, tip: nationDistricts?.get(id)?.tip ?? <b>{d.name}</b> } : null;
    }
    if (k.startsWith("d:")) {
      const d = byDistrict.get(Number(id));
      return d ? { d: d.d, tip: districtFills?.get(d.district)?.tip ?? <b>{focus}-{d.district || "AL"}</b> } : null;
    }
    const c = byCounty.get(id);
    return c ? { d: c.d, tip: countyFills?.get(id)?.tip ?? <b>{c.name}</b> } : null;
  };
  const pick = (k: string) => {
    const id = k.slice(2);
    if (k.startsWith("s:")) {
      if (fills.has(id)) onFocus(id === focus ? null : id);
    } else if (k.startsWith("n:")) {
      if (nationDistricts?.has(id)) onPickNationDistrict?.(id);
    } else if (k.startsWith("d:")) {
      if (districtFills?.has(Number(id))) onPickDistrict?.(Number(id));
    } else if (focus) {
      setZoomed(county?.fips === id ? null : { fips: id, focus, raceId });
    }
  };
  const hovered = hover.at ? hit(hover.at.key) : null;

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
      <svg
        viewBox={box.join(" ")}
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const k = keyOf(e);
          if (k && hit(k)) hover.move(e, k);
          else hover.leave();
        }}
        onPointerLeave={hover.leave}
        onClick={(e) => {
          const k = keyOf(e);
          if (k) pick(k);
        }}
      >
        {/* Stripes keep the same width on screen as the map zooms. */}
        <FlipStripes id={patternId} size={box[2] / 140} />
        {stateLayer}
        {nationDistrictLayer}
        {placeLayer}
        {/* Outlines are drawn in a layer above every shape, so neighbors can't cover part of them. */}
        {county && <path d={county.d} className="mt-line selected" vectorEffect="non-scaling-stroke" />}
        {pickedDistrict && <path d={pickedDistrict.d} className="mt-line selected" vectorEffect="non-scaling-stroke" />}
        {focused?.d && <path d={focused.d} className="mt-line focus" vectorEffect="non-scaling-stroke" />}
        {watchLayer}
        {/* Above the toss-up outlines, which would otherwise hide a marked toss-up's. */}
        {marked && <path d={marked.d} className="mt-line selected" vectorEffect="non-scaling-stroke" />}
        {markedAt && <circle cx={markedAt.x} cy={markedAt.y} r={MARK_RING} className="mt-line mt-mark" vectorEffect="non-scaling-stroke" />}
        {hovered?.d && <path d={hovered.d} className="mt-line hover" vectorEffect="non-scaling-stroke" />}
        {labelLayer}
        {/* Laid out for where the zoom is heading, so labels don't reshuffle on every frame. */}
        {cities && <CityLabels cities={cities} view={target} />}
      </svg>
      {hover.at && hovered && (
        <HoverCard at={hover.at} card={hover.card}>
          {hovered.tip}
        </HoverCard>
      )}
    </div>
  );
}
