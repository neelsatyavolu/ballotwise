// Builds the town maps for the six New England states, which report results by town rather than by county:
// public/midterms/maps/towns/XX.json (same shape and projection as build-maps.mjs's county maps, keyed by the
// town's 10-digit Census GEOID) and lib/midterms/townNames.json (each state's town names by GEOID, for matching
// civicAPI's place names). Shapes are the Census Bureau's 2024 cartographic boundary county subdivisions. It also
// writes public/midterms/maps/albers/towns/XX.json, the same towns in the national map's Albers frame (like
// build-maps.mjs's albers/XX.json county layers), so the zoomable maps can draw towns where results come by town.
// Run with `node scripts/build-towns.mjs`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { geoAlbersUsa, geoCentroid, geoConicEqualArea, geoPath } from "d3-geo";
import mapshaper from "mapshaper";
import { feature } from "topojson-client";

const STATES = { CT: "09", ME: "23", MA: "25", NH: "33", RI: "44", VT: "50" };
const W = 640;
const H = 440;
const round = (d, places = 1) => (d ?? "").replace(/-?\d+\.\d+/g, (n) => String(+(+n).toFixed(places)));

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const topo = read("../node_modules/us-atlas/counties-10m.json");
const stateFeatures = feature(topo, topo.objects.states).features;
const out = new URL("../public/midterms/maps/towns/", import.meta.url);
mkdirSync(out, { recursive: true });
const zoomOut = new URL("../public/midterms/maps/albers/towns/", import.meta.url);
mkdirSync(zoomOut, { recursive: true });
// us-atlas's counties-albers-10m.json was projected with this, so towns line up with the national map's states.
const albersPath = geoPath(geoAlbersUsa().scale(1300).translate([487.5, 305]));

const names = {};
for (const [postal, fips] of Object.entries(STATES)) {
  const url = `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_${fips}_cousub_500k.zip`;
  const zip = Buffer.from(await (await fetch(url)).arrayBuffer());
  // COUSUBFP 00000 is water outside any town. The map is drawn about 640 px wide, so finer detail is invisible.
  // gj2008 winds outer rings clockwise, as d3-geo expects; the newer GeoJSON order would draw each town inside out.
  const result = await mapshaper.applyCommands(
    `-i towns.zip -proj wgs84 -filter "COUSUBFP !== '00000'" -simplify 4% keep-shapes -filter-fields GEOID,NAMELSAD -o out.json format=geojson gj2008`,
    { "towns.zip": zip },
  );
  const towns = JSON.parse(result["out.json"]).features;
  const state = stateFeatures.find((f) => f.id === fips);
  // The county map's projection, so a town map frames the state the same way.
  const [lon, lat] = geoCentroid(state);
  const projection = geoConicEqualArea().rotate([-lon, 0]).center([0, lat]).parallels([lat - 3, lat + 3]).fitExtent([[8, 8], [W - 8, H - 8]], state);
  const path = geoPath(projection);
  const county = read(`../public/midterms/maps/${postal}.json`);
  const rows = towns.map((t) => ({ fips: t.properties.GEOID, name: t.properties.NAMELSAD, d: round(path(t)) })).sort((a, b) => a.fips.localeCompare(b.fips));
  writeFileSync(new URL(`${postal}.json`, out), JSON.stringify({ state: postal, name: county.name, viewBox: `0 0 ${W} ${H}`, outline: county.outline, counties: rows, cities: county.cities }));
  names[postal] = Object.fromEntries(rows.map((r) => [r.fips, r.name]));
  const zoomCounty = read(`../public/midterms/maps/albers/${postal}.json`);
  const zoomRows = towns.map((t) => ({ fips: t.properties.GEOID, name: t.properties.NAMELSAD, d: round(albersPath(t), 2) })).filter((r) => r.d).sort((a, b) => a.fips.localeCompare(b.fips));
  writeFileSync(new URL(`${postal}.json`, zoomOut), JSON.stringify({ counties: zoomRows, cities: zoomCounty.cities }));
  console.log(postal, rows.length, "towns");
}
writeFileSync(new URL("../lib/midterms/townNames.json", import.meta.url), JSON.stringify(names));
