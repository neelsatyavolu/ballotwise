// Map colors and layers for the past-elections precinct map.
import type { ExpressionSpecification, LayerSpecification, Map as MapLibre } from "maplibre-gl";

/** OpenFreeMap's dark basemap: free, keyless vector tiles with water, borders and place names. */
export const BASEMAP = "https://tiles.openfreemap.org/styles/dark";
export const SOURCE = "past";

// The leader's lead over the runner-up as a share of all votes, light at 0 and saturated past 40 points.
// Ends match the tracker's --dem and --rep; the third slot is --oth's purple.
const RAMPS = {
  d: ["#c6d8f8", "#8db3f0", "#4f86e2", "#1f5fcf", "#0b3d91"],
  r: ["#f8c7c2", "#f08d84", "#e2554a", "#cd332e", "#861a17"],
  a: ["#dccdfb", "#b69af6", "#8b5cf6", "#6a35d8", "#45208f"],
};
const STOPS = [0, 0.1, 0.2, 0.3, 0.45];
/** Precincts with votes but a tie at the top, and those where nobody voted (parks, airports, empty land). */
const TIE = "#8a8a8a";
const NO_VOTES = "#444";
/** Legend swatches, light to dark, with the margins they start at. */
export const LEGEND = { ramps: RAMPS, stops: STOPS.map((s) => Math.round(s * 100)) };

const d: ExpressionSpecification = ["to-number", ["get", "d"], 0];
const r: ExpressionSpecification = ["to-number", ["get", "r"], 0];
const a: ExpressionSpecification = ["to-number", ["get", "a"], 0];
const t: ExpressionSpecification = ["max", ["to-number", ["get", "t"], 0], 1];
const top: ExpressionSpecification = ["max", d, r, a];
const second: ExpressionSpecification = ["-", ["+", d, r, a], ["+", top, ["min", d, r, a]]];
const margin: ExpressionSpecification = ["/", ["-", top, second], t];
const ramp = (colors: string[]): ExpressionSpecification => ["interpolate", ["linear"], margin, ...STOPS.flatMap((s, i) => [s, colors[i]])] as ExpressionSpecification;

/** Each place's color: the leading slot's hue, deeper the bigger its lead. */
export const FILL: ExpressionSpecification = [
  "case",
  ["==", ["to-number", ["get", "t"], 0], 0], NO_VOTES,
  ["==", top, second], TIE,
  ["==", top, d], ramp(RAMPS.d),
  ["==", top, r], ramp(RAMPS.r),
  ramp(RAMPS.a),
];

export type Level = "state" | "county" | "precinct";
export const SOURCE_LAYER: Record<Level, string> = { state: "states", county: "counties", precinct: "precincts" };
/** The layer the pointer is tested against for each level; counties and states are invisible above the precincts. */
export const HIT_LAYER: Record<Level, string> = { state: "past-states-hit", county: "past-counties-hit", precinct: "past-precincts" };
const NONE: ExpressionSpecification = ["==", ["id"], -1];
/** The white outline, drawn only on the place flagged as hovered. */
const HOVER_PAINT = { "line-color": "#fff", "line-width": 2, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0] };
/** Precincts are only picked from zoom 9 (PastMap's PRECINCT_ZOOM); a little earlier keeps the outline's tiles ready. */
const PRECINCT_HOVER_ZOOM = 8;

/** What the basemap keeps: the page, water and the names of cities, towns, neighborhoods and streets. */
const KEEP = /^(background|water|place_(city|city_large|town|village|suburb)|highway_name_(other|motorway))$/;
/** The basemap's vector source, which the street lines below draw from. */
const BASEMAP_SOURCE = "openmaptiles";

const roads = (classes: string[]): ExpressionSpecification => ["all", ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false], ["match", ["get", "class"], classes, true, false]];
/**
 * Streets as faint white lines over the precinct colors, as on DDHQ's map: highways from state level, main roads from
 * county level and every street once precincts are in view. The basemap's own road layers are dark-on-dark and vanish
 * over the colors.
 */
const STREETS: { id: string; classes: string[]; minzoom: number; opacity: number; width: [number, number, number, number] }[] = [
  { id: "past-streets-minor", classes: ["tertiary", "minor", "service"], minzoom: 11, opacity: 0.18, width: [11, 0.4, 16, 3] },
  { id: "past-streets-major", classes: ["trunk", "primary", "secondary"], minzoom: 7, opacity: 0.28, width: [7, 0.4, 16, 5] },
  { id: "past-streets-motorway", classes: ["motorway"], minzoom: 5, opacity: 0.4, width: [5, 0.5, 16, 6] },
];

/**
 * Adds the election's layers to a loaded basemap: precinct colors under the water, so lakes and coasts stay cut out;
 * then streets, county and state lines, the dimming outside a selection and the hover outline, all under the place names.
 */
export function addLayers(map: MapLibre, url: string) {
  for (const layer of map.getStyle().layers) {
    if (!KEEP.test(layer.id)) map.setLayoutProperty(layer.id, "visibility", "none");
  }
  map.setPaintProperty("background", "background-color", "#1a1a1a");
  map.setPaintProperty("water", "fill-color", "#0c0c0c");
  // Place names in white over a dark halo, in their own case, so they read over any precinct color.
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol" || !KEEP.test(layer.id)) continue;
    map.setLayoutProperty(layer.id, "text-transform", "none");
    // Street names only once single streets are visible.
    if (layer.id.startsWith("highway_name")) map.setLayerZoomRange(layer.id, 13, 24);
    map.setLayoutProperty(layer.id, "icon-image", undefined);
    map.setPaintProperty(layer.id, "text-color", "#fff");
    map.setPaintProperty(layer.id, "text-halo-color", "rgba(0, 0, 0, 0.75)");
    map.setPaintProperty(layer.id, "text-halo-width", 1.2);
  }
  map.addSource(SOURCE, { type: "vector", url, attribution: "Results: New York Times, MIT Election Lab, VEST, California Statewide Database" });

  const vector = (id: string, sourceLayer: string, rest: Record<string, unknown>) =>
    ({ id, source: SOURCE, "source-layer": sourceLayer, ...rest }) as LayerSpecification;
  const labels = map.getStyle().layers.find((l) => l.type === "symbol" && KEEP.test(l.id))?.id;

  // Counties go under the precincts in their own colors, so a place a source has no precincts for still shows its county.
  map.addLayer(vector("past-counties-fill", "counties", { type: "fill", paint: { "fill-color": FILL } }), "water");
  map.addLayer(vector("past-precincts", "precincts", { type: "fill", paint: { "fill-color": FILL } }), "water");
  for (const layer of [
    vector("past-states-hit", "states", { type: "fill", paint: { "fill-opacity": 0 } }),
    vector("past-counties-hit", "counties", { type: "fill", paint: { "fill-opacity": 0 } }),
    vector("past-precincts-line", "precincts", { type: "line", minzoom: 9, paint: { "line-color": "#000", "line-opacity": 0.25, "line-width": 0.4 } }),
    ...STREETS.map(({ id, classes, minzoom, opacity, width: [z0, w0, z1, w1] }) => ({
      id,
      type: "line",
      source: BASEMAP_SOURCE,
      "source-layer": "transportation",
      minzoom,
      filter: roads(classes),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff", "line-opacity": opacity, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], z0, w0, z1, w1] },
    }) as LayerSpecification),
    vector("past-counties-line", "counties", { type: "line", minzoom: 5, paint: { "line-color": "#fff", "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.08, 9, 0.3], "line-width": 0.6 } }),
    vector("past-states-line", "states", { type: "line", paint: { "line-color": "#fff", "line-opacity": 0.45, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.5] } }),
    // Everything outside the picked state or county darkens, as on DDHQ's map.
    vector("past-dim-states", "states", { type: "fill", filter: NONE, paint: { "fill-color": "#000", "fill-opacity": 0.6 } }),
    vector("past-dim-counties", "counties", { type: "fill", filter: NONE, paint: { "fill-color": "#000", "fill-opacity": 0.6 } }),
    vector("past-states-hover", "states", { type: "line", paint: HOVER_PAINT }),
    vector("past-counties-hover", "counties", { type: "line", paint: HOVER_PAINT }),
    vector("past-precincts-hover", "precincts", { type: "line", minzoom: PRECINCT_HOVER_ZOOM, paint: HOVER_PAINT }),
  ]) {
    map.addLayer(layer, labels);
  }
}

/**
 * Returns a function that outlines the hovered place, or nothing. It flags the place with feature state instead of
 * changing a layer filter: a filter change makes MapLibre re-parse every loaded tile, which left the outline trailing
 * the pointer, while feature state only repaints.
 */
export function hoverOutline(map: MapLibre) {
  let last: { source: string; sourceLayer: string; id: string | number } | null = null;
  return (level: Level | null, id: string | number | undefined) => {
    const next = level && id !== undefined ? { source: SOURCE, sourceLayer: SOURCE_LAYER[level], id } : null;
    if (last?.sourceLayer === next?.sourceLayer && last?.id === next?.id) return;
    if (last) map.setFeatureState(last, { hover: false });
    if (next) map.setFeatureState(next, { hover: true });
    last = next;
  };
}

/** Darkens everything outside the picked state or county; nothing when the whole nation is in view. */
export function showSelection(map: MapLibre, sel: { st: string; co?: string } | null) {
  map.setFilter("past-dim-states", sel ? ["!=", ["get", "st"], sel.st] : NONE);
  map.setFilter("past-dim-counties", sel?.co ? ["all", ["==", ["get", "st"], sel.st], ["!=", ["get", "co"], sel.co]] : NONE);
}
