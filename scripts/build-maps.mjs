// Builds the projected SVG paths the results maps draw: one file per state (counties) and one for the nation (states).
// Run with `node scripts/build-maps.mjs` after updating us-atlas. Output goes to public/midterms/maps/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { geoCentroid, geoConicEqualArea, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const topo = read("../node_modules/us-atlas/counties-10m.json");
const states = read("../lib/midterms/states.json");
const out = new URL("../public/midterms/maps/", import.meta.url);
mkdirSync(out, { recursive: true });

const W = 640;
const H = 440;
// Rounds every number in a path, which is invisible at the size drawn and halves the file. Zoom layers keep 2 places.
const round = (d, places = 1) => (d ?? "").replace(/-?\d+\.\d+/g, (n) => String(+(+n).toFixed(places)));

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

// The national map and its zoom layers share us-atlas's pre-projected Albers USA frame (975 x 610),
// so a state's counties drawn on top line up exactly when the map zooms in.
const albers = read("../node_modules/us-atlas/counties-albers-10m.json");
const flat = geoPath();
const byFips = new Map(states.map(([f, p, n]) => [f, { p, n }]));
const albersStates = feature(albers, albers.objects.states).features.filter((s) => byFips.has(s.id));
const albersCounties = feature(albers, albers.objects.counties).features;
const box = (f) => flat.bounds(f).flat().map((n) => Math.round(n * 10) / 10);
writeFileSync(
  new URL("US.json", out),
  JSON.stringify({
    viewBox: "0 0 975 610",
    borders: round(flat(mesh(albers, albers.objects.states, (a, b) => a !== b)), 2),
    states: albersStates.map((s) => ({ state: byFips.get(s.id).p, name: byFips.get(s.id).n, d: round(flat(s), 2), box: box(s) })),
  }),
);
mkdirSync(new URL("albers/", out), { recursive: true });
for (const s of albersStates) {
  const own = albersCounties.filter((c) => String(c.id).startsWith(s.id));
  writeFileSync(new URL(`albers/${byFips.get(s.id).p}.json`, out), JSON.stringify({ counties: own.map((c) => ({ fips: String(c.id), name: c.properties.name, d: round(flat(c), 2) })) }));
}
console.log("wrote", states.length + 1, "maps and", albersStates.length, "zoom layers");
