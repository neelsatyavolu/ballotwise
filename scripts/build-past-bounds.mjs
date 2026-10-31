// Builds public/midterms/past/bounds.json: each state's and county's extent in longitude and latitude, so the past
// results map can zoom to a place whose tiles aren't loaded yet. Run with `node scripts/build-past-bounds.mjs`.
import { readFileSync, writeFileSync } from "node:fs";
import { geoBounds } from "d3-geo";
import { feature } from "topojson-client";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const topo = read("../node_modules/us-atlas/counties-10m.json");
const postal = new Map(read("../lib/midterms/states.json").map(([fips, p]) => [fips, p]));

// d3 gives Alaska's Aleutians a west edge past the date line (west > east); the map wants it as a negative longitude.
const box = (f) => {
  const [[w, s], [e, n]] = geoBounds(f);
  return [w > e ? w - 360 : w, s, e, n].map((x) => Math.round(x * 1000) / 1000);
};

const states = Object.fromEntries(feature(topo, topo.objects.states).features.filter((f) => postal.has(f.id)).map((f) => [postal.get(f.id), box(f)]));
const counties = Object.fromEntries(feature(topo, topo.objects.counties).features.map((f) => [String(f.id), box(f)]));
writeFileSync(new URL("../public/midterms/past/bounds.json", import.meta.url), JSON.stringify({ states, counties }));
