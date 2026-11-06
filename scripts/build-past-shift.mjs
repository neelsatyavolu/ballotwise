// Builds the past-results map's Swing view: how far each county, state and the nation moved between presidential
// races, in points of Democratic-minus-Republican margin.
//
//   node scripts/build-past-shift.mjs
//
// Writes public/midterms/past/swing-{2016,2020,2024}-president.json, each place's margin as [now, then] against the
// race four years earlier, and swing-counties.json, the county shapes the view draws (Census 2020 cartographic
// boundaries, 1:5,000,000). The tiles can't be used for this: below county zoom they merge neighboring counties and
// add up their votes, which a single county's past margin can't be compared against.
//
// County results: MEDSL's county returns (github.com/MEDSL/county-returns) for 2012 and 2016, and tonmcg's files
// (github.com/tonmcg/US_County_Level_Election_Results_08-24) for 2020 and, through lib/midterms/baseline2024.json,
// 2024. (tonmcg's 2008–2016 file is short of the certified count, 127.6 million votes in 2016 against 136.7 million.)
// Alaska reports by House district, on lines that changed in 2022, so it enters the state and national margins but no
// county; so do MEDSL's rows with no county (Maine's overseas ballots, statewide write-ins). A county is written only
// when both years have it under the same code, which leaves out Connecticut in 2024 (planning regions since 2022).
// Sources download into .cache/past-shift/ on the first run.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import states from "../lib/midterms/states.json" with { type: "json" };

const ROOT = new URL("../", import.meta.url).pathname;
const CACHE = `${ROOT}.cache/past-shift`;
const OUT = `${ROOT}public/midterms/past`;
const MEDSL = "https://raw.githubusercontent.com/MEDSL/county-returns/master/countypres_2000-2016.csv";
const TONMCG_2020 = "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2020_US_County_Level_Presidential_Results.csv";
const SHAPES = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_county_5m.zip";
/** Each race on the map with a Swing view, and the race it's compared against. */
const RACES = [
  { year: 2024, base: 2020 },
  { year: 2020, base: 2016 },
  { year: 2016, base: 2012 },
];
/**
 * Codes the maps no longer use: South Dakota's Shannon County became Oglala Lakota in 2015, and Bedford City joined
 * Bedford County, Virginia, in 2013.
 */
const RENAMED = { 46113: "46102", 51515: "51019" };
/**
 * MEDSL files Kansas City's election board as its own "county" (36000). The board counts the city's Jackson County
 * part (Clay, Platte and Cass counties count their own), so its votes go to Jackson County, as in tonmcg's 2020 file.
 */
const KANSAS_CITY = { st: "MO", fips: "36000", county: "29095" };
const POSTAL = new Map(states.map(([fips, postal]) => [fips, postal]));
const POSTALS = new Set(POSTAL.values());

async function download(url, path) {
  if (existsSync(path)) return;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

/** Splits a CSV line, honoring quoted cells (neither file has line breaks inside cells). */
function csvCells(line) {
  const cells = [];
  let cell = "", quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

async function eachRow(path, onRow) {
  let head;
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const cells = csvCells(line);
    if (!head) head = cells;
    else onRow(Object.fromEntries(head.map((k, i) => [k, cells[i]])));
  }
}

const ZERO = { d: 0, r: 0, t: 0 };
const plus = (a, b) => ({ d: a.d + b.d, r: a.r + b.r, t: a.t + b.t });
const addTo = (map, key, v) => map.set(key, plus(map.get(key) ?? ZERO, v));
/** Margins to a hundredth, so a county's move isn't rounded to exactly zero (which the map shows as neither party's). */
const margin = (v) => Math.round(((v.d - v.r) / v.t) * 10000) / 100;

/** A five-digit county code in a state the maps know, or null; Alaska's districts and statewide rows ("36000") aren't counties. */
function countyCode(raw) {
  const padded = String(raw ?? "").padStart(5, "0");
  const fips = RENAMED[padded] ?? padded;
  return /^\d{5}$/.test(fips) && POSTAL.has(fips.slice(0, 2)) && !fips.startsWith("02") && !fips.endsWith("000") ? fips : null;
}

/** Votes by county, and by state including the votes that name no county. */
function tally() {
  const counties = new Map();
  const byState = new Map();
  return {
    counties,
    byState,
    add(st, rawFips, v) {
      if (!POSTALS.has(st)) return;
      addTo(byState, st, v);
      const fips = countyCode(rawFips);
      if (fips) addTo(counties, fips, v);
    },
  };
}

async function medsl(year) {
  const path = `${CACHE}/countypres_2000-2016.csv`;
  await download(MEDSL, path);
  const out = tally();
  await eachRow(path, (row) => {
    if (row.year !== String(year)) return;
    const votes = Number(row.candidatevotes) || 0;
    const kc = row.state_po === KANSAS_CITY.st && row.FIPS === KANSAS_CITY.fips;
    out.add(row.state_po, kc ? KANSAS_CITY.county : row.FIPS, { d: row.party === "democrat" ? votes : 0, r: row.party === "republican" ? votes : 0, t: votes });
  });
  return out;
}

async function tonmcg2020() {
  const path = `${CACHE}/tonmcg-2020.csv`;
  await download(TONMCG_2020, path);
  const out = tally();
  await eachRow(path, (row) => {
    const fips = String(row.county_fips).padStart(5, "0");
    out.add(POSTAL.get(fips.slice(0, 2)), fips, { d: Number(row.votes_dem) || 0, r: Number(row.votes_gop) || 0, t: Number(row.total_votes) || 0 });
  });
  return out;
}

/** 2024 from lib/midterms/baseline2024.json (scripts/build-baseline.mjs): [Harris, Trump, total] by county. */
function tonmcg2024() {
  const out = tally();
  const file = JSON.parse(readFileSync(`${ROOT}lib/midterms/baseline2024.json`, "utf8"));
  for (const [fips, [d, r, t]] of Object.entries(file)) out.add(POSTAL.get(fips.slice(0, 2)), fips, { d, r, t });
  return out;
}

const load = (year) => (year === 2024 ? tonmcg2024() : year === 2020 ? tonmcg2020() : medsl(year));

/** [now, then] for every key both years have votes for. */
function pairs(now, then) {
  const out = {};
  for (const key of [...now.keys()].sort()) {
    const a = now.get(key), b = then.get(key);
    if (a?.t > 0 && b?.t > 0) out[key] = [margin(a), margin(b)];
  }
  return out;
}

async function buildRace({ year, base }) {
  const [now, then] = [await load(year), await load(base)];
  const total = (t) => [...t.byState.values()].reduce(plus, ZERO);
  const out = {
    id: `${year}-president`,
    year,
    base,
    us: [margin(total(now)), margin(total(then))],
    states: pairs(now.byState, then.byState),
    counties: pairs(now.counties, then.counties),
  };
  writeFileSync(`${OUT}/swing-${out.id}.json`, JSON.stringify(out));
  console.log(`${year} vs ${base}: US ${out.us.join(" vs ")}, ${Object.keys(out.states).length} states, ${Object.keys(out.counties).length} counties`);
  // PAST_AUDIT=1 prints each state's margins, to check against certified results.
  if (process.env.PAST_AUDIT) console.log(Object.entries(out.states).map(([st, [a, b]]) => `${st} ${a}/${b}`).join("  "));
}

/** County shapes for the 50 states and DC, simplified for a national view, each with its code, name and state. */
async function buildShapes() {
  const zip = `${CACHE}/cb_2020_us_county_5m.zip`;
  await download(SHAPES, zip);
  const dir = `${CACHE}/counties-5m`;
  execFileSync("unzip", ["-o", "-q", "-d", dir, zip]);
  const raw = `${dir}/counties.json`;
  execFileSync("npx", [
    "mapshaper", "-i", `${dir}/cb_2020_us_county_5m.shp`, "-filter", "Number(STATEFP) <= 56",
    "-simplify", "40%", "keep-shapes", "-each", "co=GEOID, cn=NAME", "-filter-fields", "co,cn",
    "-o", raw, "format=geojson", "precision=0.001",
  ], { stdio: "inherit" });
  const fc = JSON.parse(readFileSync(raw, "utf8"));
  const features = fc.features.map((f) => ({ ...f, properties: { ...f.properties, st: POSTAL.get(f.properties.co.slice(0, 2)) } }));
  writeFileSync(`${OUT}/swing-counties.json`, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`shapes: ${features.length} counties`);
}

mkdirSync(CACHE, { recursive: true });
for (const race of RACES) await buildRace(race);
await buildShapes();
