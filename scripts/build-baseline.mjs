// Builds lib/midterms/baseline2024.json: each county's 2024 presidential vote as [Harris, Trump, total], from github.com/tonmcg/US_County_Level_Election_Results_08-24.
// Run with `node scripts/build-baseline.mjs`.
import { writeFileSync } from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2024_US_County_Level_Presidential_Results.csv";
const csv = await (await fetch(SOURCE)).text();
const [header, ...rows] = csv.trim().split("\n");
const cols = header.split(",");
const at = (name) => cols.indexOf(name);
const votes = {};
for (const row of rows) {
  const cells = row.split(",");
  const fips = cells[at("county_fips")].padStart(5, "0");
  const total = +cells[at("total_votes")];
  if (!total) continue;
  votes[fips] = [+cells[at("votes_dem")], +cells[at("votes_gop")], total];
}
writeFileSync(new URL("../lib/midterms/baseline2024.json", import.meta.url), JSON.stringify(votes));
console.log("counties", Object.keys(votes).length, "cols", cols.join("|"));
