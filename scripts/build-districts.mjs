// Builds the congressional district layers the House map draws when it zooms into a state.
// Run with `node scripts/build-districts.mjs`. Output goes to public/midterms/maps/districts/.
// Lines are the Census Bureau's 120th Congress districts, the ones in effect for the 2026 election. Missouri's
// 120th file still shows the map the Supreme Court kept out of 2026, so Missouri uses its 119th lines, which are
// the same plan used in 2022 and 2024. Census lines run out into lakes and the sea, so each state's districts are
// clipped to us-atlas's coastline, the same one the map draws.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geoAlbersUsa, geoPath } from "d3-geo";
import mapshaper from "mapshaper";
import { feature } from "topojson-client";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const states = read("../lib/midterms/states.json");
const out = new URL("../public/midterms/maps/districts/", import.meta.url);
mkdirSync(out, { recursive: true });

const fileFor = (fips) => (fips === "29" ? `TIGER2025/CD/tl_2025_${fips}_cd119.zip` : `TIGER2026/CD/tl_2026_${fips}_cd120.zip`);
const topo = read("../node_modules/us-atlas/states-10m.json");
const outlines = new Map(feature(topo, topo.objects.states).features.map((f) => [f.id, f]));
// us-atlas's Albers files were projected with this, so districts land on the map's states and counties.
const path = geoPath(geoAlbersUsa().scale(1300).translate([487.5, 305]));
const round = (d) => (d ?? "").replace(/-?\d+\.\d+/g, (n) => String(+(+n).toFixed(2)));

const work = mkdtempSync(join(tmpdir(), "districts-"));
let written = 0;
try {
  for (const [fips, postal] of states) {
    const outline = outlines.get(fips);
    if (!outline || postal === "DC") continue;
    const res = await fetch(`https://www2.census.gov/geo/tiger/${fileFor(fips)}`);
    if (!res.ok) throw new Error(`${postal}: Census returned ${res.status}`);
    const dir = join(work, postal);
    mkdirSync(dir);
    writeFileSync(join(dir, "cd.zip"), Buffer.from(await res.arrayBuffer()));
    execFileSync("unzip", ["-q", "cd.zip"], { cwd: dir });
    const shp = readdirSync(dir).find((f) => f.endsWith(".shp"));
    writeFileSync(join(dir, "outline.json"), JSON.stringify(outline));
    // Keeps enough detail for a city district seen up close, which is still a small file once projected and rounded.
    // gj2008 winds outer rings clockwise, as d3-geo expects; the newer GeoJSON order would draw each district inside out.
    const field = fips === "29" ? "CD119FP" : "CD120FP";
    const { "out.json": geo } = await mapshaper.applyCommands(
      `-i ${join(dir, shp)} -proj wgs84 -clip ${join(dir, "outline.json")} -simplify 4% keep-shapes -filter-fields ${field} -o out.json format=geojson gj2008`,
    );
    const districts = JSON.parse(geo).features
      .map((f) => ({ code: f.properties[field], d: round(path(f)) }))
      // "ZZ" is water Census leaves out of every district; "98" is a nonvoting delegate's seat.
      .filter((f) => /^\d\d$/.test(f.code) && f.code !== "98" && f.d)
      .map((f) => ({ district: Number(f.code), d: f.d }))
      .sort((a, b) => a.district - b.district);
    writeFileSync(new URL(`${postal}.json`, out), JSON.stringify({ districts }));
    written += 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log("wrote", written, "district layers");
