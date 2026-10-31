"use client";

// Past elections down to the precinct, after DDHQ's results map: hover a state, county or precinct for its results;
// pick a state or county to zoom in and darken everything around it.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONFeature, MapGeoJSONFeature, Map as MapLibre, MapMouseEvent, VectorTileSource } from "maplibre-gl";
import states from "@/lib/midterms/states.json";
import { countyLabel, rowsFor, type Summary, type Votes } from "@/lib/midterms/pastResults";
import { ELECTIONS, summaryUrl, tilesUrl } from "./elections";
import { PastPanel, type Place } from "./PastPanel";
import { ResultsTip } from "./Results";
import { addLayers, BASEMAP, HIT_LAYER, hoverOutline, showSelection, SOURCE, SOURCE_LAYER, type Level } from "./style";

const STATE_NAMES = new Map((states as string[][]).map(([, postal, name]) => [postal, name]));
const US_BOUNDS: [[number, number], [number, number]] = [[-125, 24.5], [-66.9, 49.4]];
const MODES: { id: Mode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "state", label: "State" },
  { id: "county", label: "County" },
  { id: "precinct", label: "Precinct" },
];
type Mode = "auto" | Level;
type Tip = { x: number; y: number; right: boolean; low: boolean; level: Level; props: Record<string, unknown> };

/**
 * Below this zoom the tiles merge neighboring precincts (keeping one's name and summing their votes), so precincts
 * can't be picked there.
 */
const PRECINCT_ZOOM = 9;
/** What the pointer picks on its own: states from afar, counties closer in, precincts once they're big enough to aim at. */
const autoLevel = (zoom: number): Level => (zoom < 5 ? "state" : zoom < PRECINCT_ZOOM ? "county" : "precinct");
let protocolAdded = false;

type Box = [number, number, number, number];
type Bounds = { states: Record<string, Box>; counties: Record<string, Box> };
/** Every state's and county's extent (scripts/build-past-bounds.mjs), loaded once. */
let boundsFile: Promise<Bounds | null> | undefined;
const loadBounds = () =>
  (boundsFile ??= fetch("/midterms/past/bounds.json")
    .then((r) => (r.ok ? (r.json() as Promise<Bounds>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((err) => {
      console.error("past results bounds failed:", err instanceof Error ? err.message : err);
      return null;
    }));
const toLngLat = (b: Box | undefined): [[number, number], [number, number]] | null => (b ? [[b[0], b[1]], [b[2], b[3]]] : null);

/** A county's votes from the loaded tiles, or null when it has none in this election (or isn't loaded). */
function countyVotes(map: MapLibre, co: string): Votes | null {
  const f = map.querySourceFeatures(SOURCE, { sourceLayer: SOURCE_LAYER.county, filter: ["==", ["get", "co"], co] })[0];
  return f ? votesOf(f.properties) : null;
}

const votesOf = (p: Record<string, unknown>): Votes => ({ d: Number(p.d) || 0, r: Number(p.r) || 0, a: Number(p.a) || 0, t: Number(p.t) || 0 });
/** Leaves room for the sidebar, which covers the map's left side on wide screens. */
const padding = () => (window.innerWidth >= 900 ? { left: 420, top: 40, right: 40, bottom: 40 } : 24);

/** A place's extent from its pieces in the loaded tiles. Longitudes east of 0 are Alaska's past the date line. */
function boundsOf(features: GeoJSONFeature[]): [[number, number], [number, number]] | null {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number") {
      const x = c[0] > 0 ? c[0] - 360 : c[0];
      [w, s, e, n] = [Math.min(w, x), Math.min(s, c[1]), Math.max(e, x), Math.max(n, c[1])];
      return;
    }
    c.forEach(visit);
  };
  for (const f of features) if ("coordinates" in f.geometry) visit(f.geometry.coordinates);
  return w <= e ? [[w, s], [e, n]] : null;
}

export function PastMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const hover = useRef<ReturnType<typeof hoverOutline> | null>(null);
  const [ready, setReady] = useState(false);
  const [electionId, setElectionId] = useState(ELECTIONS[0].id);
  // The summary for whichever election last loaded; one for another election counts as still loading.
  const [loaded, setLoaded] = useState<{ id: string; summary: Summary | "error" } | null>(null);
  const summary = loaded?.id === electionId ? loaded.summary : null;
  const [mode, setMode] = useState<Mode>("auto");
  const [zoom, setZoom] = useState(3);
  const [place, setPlace] = useState<Place | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const level = mode === "auto" ? autoLevel(zoom) : mode === "precinct" && zoom < PRECINCT_ZOOM ? "county" : mode;

  // The map's handlers are bound once, so they read the current choices through this.
  const live = useRef({ level, electionId });
  useEffect(() => {
    live.current = { level, electionId };
  }, [level, electionId]);

  const fit = (bounds: [[number, number], [number, number]] | null) => {
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: padding(), maxZoom: 11, duration: 600 });
  };

  const pickNation = () => {
    setPlace(null);
    mapRef.current?.fitBounds(US_BOUNDS, { padding: padding(), duration: 600 });
  };

  /** Zooms to a state or county, from the bounds file, or from its pieces on screen if the file lacks it. */
  const fitPlace = async (sourceLayer: string, key: "st" | "co", value: string) => {
    const all = await loadBounds();
    const known = toLngLat(key === "st" ? all?.states[value] : all?.counties[value]);
    const map = mapRef.current;
    if (map) fit(known ?? boundsOf(map.querySourceFeatures(SOURCE, { sourceLayer, filter: ["==", ["get", key], value] })));
  };

  const pickState = (st: string) => {
    setPlace({ st, stateName: STATE_NAMES.get(st) ?? st });
    void fitPlace(SOURCE_LAYER.state, "st", st);
  };

  /** Picks the county of a county or precinct `p`, with the county's own votes. */
  const pickCounty = (p: Record<string, unknown>, zoomTo: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const st = String(p.st);
    const co = String(p.co);
    setPlace({ st, stateName: STATE_NAMES.get(st) ?? st, co, county: countyLabel(st, co, String(p.cn ?? "")), votes: countyVotes(map, co) });
    if (zoomTo) void fitPlace(SOURCE_LAYER.county, "co", co);
  };

  // Handlers bound once; they reach the latest pickers through this.
  const pickers = useRef({ pickNation, pickState, pickCounty });
  useEffect(() => {
    pickers.current = { pickNation, pickState, pickCounty };
  });

  useEffect(() => {
    let map: MapLibre | undefined;
    let cancelled = false;
    (async () => {
      const [maplibregl, { Protocol }] = await Promise.all([import("maplibre-gl"), import("pmtiles")]);
      if (cancelled || !container.current) return;
      if (!protocolAdded) {
        maplibregl.addProtocol("pmtiles", new Protocol().tile);
        // Copied there by scripts/copy-maplibre-worker.mjs.
        maplibregl.setWorkerUrl("/midterms/vendor/maplibre-gl-worker.mjs");
        protocolAdded = true;
      }
      const m = new maplibregl.Map({
        container: container.current,
        style: BASEMAP,
        bounds: US_BOUNDS,
        fitBoundsOptions: { padding: padding() },
        minZoom: 2,
        maxZoom: 14,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
      });
      map = m;
      m.touchZoomRotate.disableRotation();
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      m.on("error", (e) => {
        if ((e as { sourceId?: string }).sourceId === SOURCE) setTilesFailed(true);
      });
      m.on("zoomend", () => setZoom(m.getZoom()));

      const hit = (e: MapMouseEvent): { lv: Level; f: MapGeoJSONFeature | undefined } => {
        const lv = live.current.level;
        const f = m.queryRenderedFeatures(e.point, { layers: [HIT_LAYER[lv]] })[0];
        // Where a source has no precinct, the county under it answers instead.
        if (f || lv !== "precinct") return { lv, f };
        return { lv: "county", f: m.queryRenderedFeatures(e.point, { layers: [HIT_LAYER.county] })[0] };
      };
      const showTip = (e: MapMouseEvent, lv: Level, f: MapGeoJSONFeature) => {
        const { width, height } = m.getContainer().getBoundingClientRect();
        setTip({ x: e.point.x, y: e.point.y, right: e.point.x > width / 2, low: e.point.y > height / 2, level: lv, props: f.properties });
      };
      // The pointer handlers wait for the election's layers, which they test against.
      m.on("load", () => {
        addLayers(m, tilesUrl(live.current.electionId));
        mapRef.current = m;
        hover.current = hoverOutline(m);
        setZoom(m.getZoom());
        setReady(true);
        bindPointer();
      });
      const bindPointer = () => {
        m.on("mousemove", (e) => {
          const { lv, f } = hit(e);
          hover.current?.(f ? lv : null, f?.id);
          m.getCanvas().style.cursor = f ? "pointer" : "";
          if (f) showTip(e, lv, f);
          else setTip(null);
        });
        m.on("mouseout", () => {
          hover.current?.(null, undefined);
          setTip(null);
        });
        m.on("click", (e) => {
          const { lv, f } = hit(e);
          if (!f) return pickers.current.pickNation();
          // A tap shows the tooltip too, since touch screens have no hover.
          hover.current?.(lv, f.id);
          showTip(e, lv, f);
          if (lv === "state") pickers.current.pickState(String(f.properties.st));
          else pickers.current.pickCounty(f.properties, live.current.level === "county");
        });
      };
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // A new election swaps the tiles in place and keeps the view and the picked place, with that place's new votes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource(SOURCE) as VectorTileSource | undefined;
    const url = tilesUrl(electionId);
    if (!source || source.url === url) return;
    setTilesFailed(false);
    setTip(null);
    // Feature ids differ between elections' tiles, so the old outline would land on some other place.
    hover.current?.(null, undefined);
    source.setUrl(url);
    const co = place?.co;
    if (!co) return;
    // A picked county reads its new votes from the new tiles; if it's off screen, the map goes to it first.
    map.once("idle", async () => {
      let votes = countyVotes(map, co);
      if (!votes) {
        await fitPlace(SOURCE_LAYER.county, "co", co);
        await map.once("idle");
        votes = countyVotes(map, co);
      }
      setPlace((p) => (p?.co === co ? { ...p, votes } : p));
    });
    // Only a new election starts this; the picked county is read when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electionId, ready]);

  useEffect(() => {
    let current = true;
    fetch(summaryUrl(electionId))
      .then((r) => (r.ok ? (r.json() as Promise<Summary>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((s) => current && setLoaded({ id: electionId, summary: s }))
      .catch((err) => {
        console.error("past results summary failed:", err instanceof Error ? err.message : err);
        if (current) setLoaded({ id: electionId, summary: "error" });
      });
    return () => {
      current = false;
    };
  }, [electionId]);

  useEffect(() => {
    if (ready && mapRef.current) showSelection(mapRef.current, place ? { st: place.st, co: place.co } : null);
  }, [place, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pickers.current.pickNation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mt-past">
      <div ref={container} className="mt-past-map" />
      <PastPanel electionId={electionId} onElection={setElectionId} summary={summary} place={place} onNation={pickNation} onState={pickState} />
      <label className="mt-past-mode">
        <span>Selecting:</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>{m.id === "auto" ? `Auto: ${MODES.find((x) => x.id === level)?.label}` : m.label}</option>
          ))}
        </select>
      </label>
      {tilesFailed ? <p className="mt-past-error">The precinct map didn&rsquo;t load. Try again in a moment.</p> : null}
      {tip && summary && summary !== "error" ? <PlaceTip tip={tip} summary={summary} /> : null}
    </div>
  );
}

function PlaceTip({ tip, summary }: { tip: Tip; summary: Summary }) {
  const p = tip.props;
  const st = String(p.st ?? "");
  const rows = rowsFor(votesOf(p), summary.states[st]?.slots ?? {});
  const county = countyLabel(st, String(p.co ?? ""), String(p.cn ?? ""));
  const title = tip.level === "state" ? STATE_NAMES.get(st) ?? st : tip.level === "county" ? county : String(p.nm ?? "Precinct");
  const subtitle = tip.level === "precinct" ? [county, st].filter(Boolean).join(", ") : tip.level === "county" ? st : undefined;
  return (
    <div
      className="mt-past-tip"
      style={{ left: tip.x, top: tip.y, transform: `translate(${tip.right ? "calc(-100% - 14px)" : "14px"}, ${tip.low ? "calc(-100% - 14px)" : "14px"})` }}
    >
      <ResultsTip title={title} subtitle={subtitle} rows={rows} />
    </div>
  );
}
