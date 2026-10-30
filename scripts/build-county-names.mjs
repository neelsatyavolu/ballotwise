// Builds lib/midterms/countyNames.json: each state's county names by FIPS, from the county maps build-maps.mjs writes.
// The early vote feed names counties without FIPS codes; this lets the server put them on the map.
// Run with `node scripts/build-county-names.mjs` after build-maps.mjs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../public/midterms/maps/albers/", import.meta.url);
const names = {};
for (const file of readdirSync(dir).filter((f) => /^[A-Z]{2}\.json$/.test(f)).sort()) {
  const { counties } = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  names[file.slice(0, 2)] = Object.fromEntries(counties.map((c) => [c.fips, c.name]).sort(([a], [b]) => a.localeCompare(b)));
}
writeFileSync(new URL("../lib/midterms/countyNames.json", import.meta.url), JSON.stringify(names));
console.log("states", Object.keys(names).length, "counties", Object.values(names).reduce((n, s) => n + Object.keys(s).length, 0));
