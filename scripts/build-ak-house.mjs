// Builds Alaska's state House district maps, for races whose results come by district: DDHQ reports Alaska by its 40
// House districts, not by borough. Writes public/midterms/maps/ak-house/AK.json (the state map, in build-maps.mjs's
// projection), public/midterms/maps/albers/ak-house/AK.json (the zoomable maps' Albers layer) and
// lib/midterms/akHouse2024.json (each district's 2024 presidential vote as [Harris, Trump, total], from
// lib/midterms/baseline2024.json, which tonmcg files under 02001-02040).
//
// Districts are keyed 029 + their number ("02901"), as on the past-results map: DDHQ's own codes, 02001-02040, are
// borough codes too (Anchorage is 02020). Shapes are the Census Bureau's 2023 cartographic boundary lower-house
// districts: the 2022 plan, which the 2024 and 2026 elections use.
// Run with `node scripts/build-ak-house.mjs`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { geoAlbersUsa, geoCentroid, geoConicEqualArea, geoPath } from "d3-geo";
import mapshaper from "mapshaper";
import { feature } from "topojson-client";

const W = 640;
const H = 440;
const SHAPES = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_02_sldl_500k.zip";
const round = (d, places = 1) => (d ?? "").replace(/-?\d+\.\d+/g, (n) => String(+(+n).toFixed(places)));
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
/** "02901" for District 1. */
const codeOf = (n) => `029${String(n).padStart(2, "0")}`;

const res = await fetch(SHAPES);
if (!res.ok) throw new Error(`${SHAPES}: HTTP ${res.status}`);
// gj2008 winds outer rings clockwise, as d3-geo expects; the newer GeoJSON order would draw each district inside out.
const result = await mapshaper.applyCommands(
  `-i sldl.zip -proj wgs84 -simplify 4% keep-shapes -filter-fields SLDLST -o out.json format=geojson gj2008`,
  { "sldl.zip": Buffer.from(await res.arrayBuffer()) },
);
const districts = JSON.parse(result["out.json"]).features
  .map((f) => ({ ...f, n: Number(f.properties.SLDLST) }))
  .filter((f) => f.n >= 1 && f.n <= 40)
  .sort((a, b) => a.n - b.n);
if (districts.length !== 40) throw new Error(`expected 40 districts, got ${districts.length}`);

// The state map's projection (build-maps.mjs), so the district map frames Alaska as the borough map does.
const topo = read("../node_modules/us-atlas/counties-10m.json");
const state = feature(topo, topo.objects.states).features.find((f) => f.id === "02");
const [lon, lat] = geoCentroid(state);
const projection = geoConicEqualArea().rotate([-lon, 0]).center([0, lat]).parallels([lat - 3, lat + 3]).fitExtent([[8, 8], [W - 8, H - 8]], state);
const path = geoPath(projection);
const boroughs = read("../public/midterms/maps/AK.json");
const rows = (draw, places) => districts.map((f) => ({ fips: codeOf(f.n), name: `District ${f.n}`, d: round(draw(f), places) })).filter((r) => r.d);

const out = new URL("../public/midterms/maps/ak-house/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("AK.json", out), JSON.stringify({ state: "AK", name: boroughs.name, viewBox: `0 0 ${W} ${H}`, outline: boroughs.outline, counties: rows(path, 1), cities: boroughs.cities }));

// us-atlas's counties-albers-10m.json was projected with this, so districts line up with the national map's states.
const albersPath = geoPath(geoAlbersUsa().scale(1300).translate([487.5, 305]));
const zoomOut = new URL("../public/midterms/maps/albers/ak-house/", import.meta.url);
mkdirSync(zoomOut, { recursive: true });
writeFileSync(new URL("AK.json", zoomOut), JSON.stringify({ counties: rows(albersPath, 2), cities: read("../public/midterms/maps/albers/AK.json").cities }));

const baseline = read("../lib/midterms/baseline2024.json");
const pres = Object.fromEntries(districts.map((f) => [codeOf(f.n), baseline[`020${String(f.n).padStart(2, "0")}`]]).filter(([, v]) => v));
writeFileSync(new URL("../lib/midterms/akHouse2024.json", import.meta.url), JSON.stringify(pres));
console.log("AK:", districts.length, "districts,", Object.keys(pres).length, "with 2024 votes");
