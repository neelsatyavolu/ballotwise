// Builds the projected SVG paths the results maps draw: one file per state (counties) and one for the nation (states).
// Run with `node scripts/build-maps.mjs` after updating us-atlas. Output goes to public/midterms/maps/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { geoAlbersUsa, geoCentroid, geoConicEqualArea, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const topo = read("../node_modules/us-atlas/counties-10m.json");
const states = read("../lib/midterms/states.json");
const out = new URL("../public/midterms/maps/", import.meta.url);
mkdirSync(out, { recursive: true });

const W = 640;
const H = 440;
// Rounds every number in a path to 1 decimal, which is invisible at this size and halves the file.
const round = (d) => (d ?? "").replace(/-?\d+\.\d+/g, (n) => (+n).toFixed(1).replace(/\.0$/, ""));

const counties = feature(topo, topo.objects.counties).features;
const stateFeatures = feature(topo, topo.objects.states).features;

for (const [fips, postal, name] of states) {
  const state = stateFeatures.find((f) => f.id === fips);
  if (!state) continue;
  const [lon, lat] = geoCentroid(state);
  // An equal-area conic centered on the state keeps every state, Alaska included, upright and undistorted.
  const projection = geoConicEqualArea().rotate([-lon, 0]).center([0, lat]).parallels([lat - 3, lat + 3]).fitExtent([[8, 8], [W - 8, H - 8]], state);
  const path = geoPath(projection);
  const own = counties.filter((c) => String(c.id).startsWith(fips));
  const file = {
    state: postal,
    name,
    viewBox: `0 0 ${W} ${H}`,
    outline: round(path(state)),
    counties: own.map((c) => ({ fips: String(c.id), name: c.properties.name, d: round(path(c)) })),
  };
  writeFileSync(new URL(`${postal}.json`, out), JSON.stringify(file));
}

const nation = geoPath(geoAlbersUsa().fitExtent([[8, 8], [960 - 8, 600 - 8]], feature(topo, topo.objects.nation)));
const byFips = new Map(states.map(([f, p, n]) => [f, { p, n }]));
writeFileSync(
  new URL("US.json", out),
  JSON.stringify({
    viewBox: "0 0 960 600",
    borders: round(nation(mesh(topo, topo.objects.states, (a, b) => a !== b))),
    states: stateFeatures.filter((s) => byFips.has(s.id)).map((s) => ({ state: byFips.get(s.id).p, name: byFips.get(s.id).n, d: round(nation(s)) })),
  }),
);
console.log("wrote", states.length + 1, "maps");
