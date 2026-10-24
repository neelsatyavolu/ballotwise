// Builds lib/midterms/holders.json: the party holding each Senate and House seat going into Nov 3, 2026,
// from the current members in github.com/unitedstates/congress-legislators. Governors are listed by hand in holders.ts.
// Run with `node scripts/build-holders.mjs`.
import { writeFileSync } from "node:fs";

const SOURCE = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const members = await (await fetch(SOURCE)).json();
const short = (party) => (party === "Democrat" ? "D" : party === "Republican" ? "R" : "I");

const senate = {};
const special = {};
const house = {};
for (const m of members) {
  const term = m.terms.at(-1);
  if (term.type === "sen") {
    // Class 2 seats are up in 2026; Ohio's and Florida's class 3 seats hold specials.
    if (term.class === 2) senate[term.state] = short(term.party);
    if (term.class === 3 && ["OH", "FL"].includes(term.state)) special[term.state] = short(term.party);
  } else {
    house[`${term.state}-${term.district}`] = short(term.party);
  }
}
writeFileSync(new URL("../lib/midterms/holders.json", import.meta.url), `${JSON.stringify({ senate, special, house })}\n`);
console.log("senate", Object.keys(senate).length, "special", special, "house", Object.keys(house).length);
