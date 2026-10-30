// Builds lib/midterms/lean2026.json, the forecast's partisan baseline and incumbents:
//   house:      2024 presidential margin (Harris minus Trump, points of the total vote) for each district as drawn
//               for 2026, from The Downballot's calculations (all 10 states with new maps included).
//   state:      the same margin statewide, summed from the county results in lib/midterms/baseline2024.json.
//   incumbents: who holds each seat on the ballot, so the forecast can tell when an incumbent is running.
//               House from The Downballot's sheet, Senate from congress-legislators, governors from Wikidata.
// Run with `node scripts/build-lean.mjs`.
import { readFileSync, writeFileSync } from "node:fs";

const SHEET = "https://docs.google.com/spreadsheets/d/1eZfaFI-c-PFOoKx1-zZA2MP0_dxRq_LVK0re3BOQqy0/export?format=csv&gid=1491069057";
const LEGISLATORS = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const WIKIDATA = "https://query.wikidata.org/sparql";
const UA = "Ballotwise/1.0 (https://ballotwise.xanom.co; forecast baseline build)";
const TIMEOUT_MS = 60_000;

const get = async (url, init = {}) => {
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res;
};

/** One CSV line into fields, honoring quoted fields with commas ("140,026"). */
function fields(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const num = (s) => Number(String(s).replace(/[,%]/g, ""));
const round1 = (x) => Math.round(x * 10) / 10;

// ---------- House: The Downballot ----------

const house = {};
const incumbents = {};
for (const line of (await (await get(SHEET)).text()).split(/\r?\n/)) {
  const f = fields(line);
  const m = f[0]?.match(/^([A-Z]{2})-(\d{2}|AL)$/);
  if (!m) continue;
  const [harris, trump, total] = [num(f[4]), num(f[5]), num(f[6])];
  if (!(total > 0)) continue;
  const key = `house:${m[1]}:${m[2] === "AL" ? 0 : Number(m[2])}`;
  house[key] = round1(((harris - trump) / total) * 100);
  if (f[1]?.trim()) incumbents[key] = f[1].trim();
}

// ---------- States: county results ----------

const postal = new Map(JSON.parse(readFileSync(new URL("../lib/midterms/states.json", import.meta.url), "utf8")).map(([fips, code]) => [fips, code]));
const sums = {};
for (const [fips, [harris, trump, total]] of Object.entries(JSON.parse(readFileSync(new URL("../lib/midterms/baseline2024.json", import.meta.url), "utf8")))) {
  const code = postal.get(fips.slice(0, 2));
  if (!code) continue;
  const s = (sums[code] ??= [0, 0, 0]);
  s[0] += harris;
  s[1] += trump;
  s[2] += total;
}
const state = Object.fromEntries(Object.entries(sums).map(([code, [h, t, n]]) => [code, round1(((h - t) / n) * 100)]));

// ---------- Senate: congress-legislators ----------

for (const m of await (await get(LEGISLATORS)).json()) {
  const term = m.terms.at(-1);
  if (term.type !== "sen") continue;
  const name = m.name.official_full ?? `${m.name.first} ${m.name.last}`;
  // Class 2 seats are up in 2026; Ohio's and Florida's class 3 seats hold specials, and neither state has a regular race.
  if (term.class === 2 || (term.class === 3 && ["OH", "FL"].includes(term.state))) incumbents[`senate:${term.state}:`] = name;
}

// ---------- Governors: Wikidata ----------

try {
  const query = `SELECT ?code ?name WHERE {
    ?state wdt:P31 wd:Q35657; wdt:P5086 ?code; wdt:P1313 ?office.
    ?person p:P39 ?held. ?held ps:P39 ?office. FILTER NOT EXISTS { ?held pq:P582 ?end }
    ?person rdfs:label ?name. FILTER(LANG(?name) = "en")
  }`;
  const rows = (await (await get(WIKIDATA, { method: "POST", body: new URLSearchParams({ query, format: "json" }), headers: { accept: "application/sparql-results+json" } })).json()).results.bindings;
  for (const r of rows) incumbents[`governor:${r.code.value.replace(/^US-/, "")}:`] = r.name.value;
} catch (err) {
  console.error("Governors from Wikidata failed; governor incumbency is left out:", err.message);
}

writeFileSync(new URL("../lib/midterms/lean2026.json", import.meta.url), `${JSON.stringify({ house, state, incumbents })}\n`);
console.log("districts", Object.keys(house).length, "states", Object.keys(state).length, "incumbents", Object.keys(incumbents).length);
console.log("e.g.", house["house:CA:22"], house["house:TX:35"], state.PA, state.NC, incumbents["senate:ME:"], incumbents["governor:PA:"]);
