// Builds the past-results precinct maps (app/midterms/past): one PMTiles file per election, holding every precinct,
// county and state with its votes, and a small summary per election for the sidebar.
//
//   node --max-old-space-size=32000 scripts/build-precincts.mjs [election id ...]
//
// Needs mapshaper (a dev dependency) and tippecanoe (`brew install tippecanoe`). Sources download into
// .cache/precincts/ on the first run. Tiles land in .cache/precincts/tiles/; upload them with
// `scripts/upload-precincts.sh`. Summaries go to public/midterms/past/.
//
// Sources:
//   NYT precinct map for 2024 president (MIT): github.com/nytimes/presidential-precinct-map-2024. It reports
//     Democratic, Republican and total votes only, and leaves out Alaska.
//   VEST precinct results for 2016, 2018 and 2020 (CC BY 4.0) on Harvard Dataverse. (The NYT's 2020 map leaves out
//     precincts in states that report absentee votes countywide, most of Kentucky and Missouri among them; VEST
//     spreads those votes over the precincts.)
//   California's 2018 results by precinct from the Statewide Database (statewidedatabase.org), which VEST lacks.
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ROOT = new URL("../", import.meta.url).pathname;
const CACHE = `${ROOT}.cache/precincts`;
const OUT = `${ROOT}public/midterms/past`;
const MAPSHAPER = [`--max-old-space-size=32000`, `${ROOT}node_modules/mapshaper/bin/mapshaper`];
const STATES = JSON.parse(readFileSync(`${ROOT}lib/midterms/states.json`, "utf8"));

// Connecticut replaced its counties with planning regions in 2022, and the NYT's 2024 data uses them.
const CT_REGIONS = {
  "09110": "Capitol", "09120": "Greater Bridgeport", "09130": "Lower Connecticut River Valley", "09140": "Naugatuck Valley",
  "09150": "Northeastern Connecticut", "09160": "Northwest Hills", "09170": "South Central Connecticut",
  "09180": "Southeastern Connecticut", "09190": "Western Connecticut",
};
// Alaska reports its votes by state House district, not borough; the 2024 map counts each district as a county, coded
// 029 + its number so the codes can't collide with a borough's.
const AK_DISTRICTS = Array.from({ length: 40 }, (_, i) => [`029${String(i + 1).padStart(2, "0")}`, `District ${i + 1}`]);
const COUNTY_NAMES = new Map([
  ...Object.values(JSON.parse(readFileSync(`${ROOT}lib/midterms/countyNames.json`, "utf8"))).flatMap((byFips) => Object.entries(byFips)),
  ...Object.entries(CT_REGIONS),
  ...AK_DISTRICTS,
  // Alaska split Valdez-Cordova in two in 2019; the Census's 2020 counties have the new boroughs.
  ["02063", "Chugach"],
  ["02066", "Copper River"],
]);
const STATE_BY_FIPS = new Map(STATES.map(([fips, st]) => [fips, st]));

const DATAVERSE = "https://dataverse.harvard.edu/api";
const VEST = { 2016: "NH5S2I", 2018: "UBKYRU", 2020: "K7760H" };
const NYT_2024 = (st) => `https://int.nyt.com/newsgraphics/elections/map-data/2024/national/${st}-precincts-with-results.topojson.gz`;
const SWDB_2018 = "https://statewidedatabase.org/pub/data/G18/state";
const MEDSL_2024 = "https://raw.githubusercontent.com/MEDSL/2024-elections-official/main";
const TONMCG_2024 = "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2024_US_County_Level_Presidential_Results.csv";
const CENSUS = "https://www2.census.gov/geo/tiger";
/** Census county shapes: 2020's for VEST's years, and 2023's, with Connecticut's planning regions, for 2024. */
const COUNTIES_500K = `${CACHE}/census/counties-2020.geojson`;
const COUNTIES_2023 = `${CACHE}/census/counties-2023.geojson`;

const DEM = (name) => ({ name, party: "DEM" });
const GOP = (name) => ({ name, party: "GOP" });

/**
 * Every past election on the map. `vest` names the VEST office code; `nyt` the NYT year with its two nominees;
 * `nominees` spells the major-party nominees the same way across elections ("Joseph Biden" → "Joe Biden").
 */
const ELECTIONS = [
  { id: "2024-president", year: 2024, office: "President", nyt: { d: DEM("Kamala Harris"), r: GOP("Donald J. Trump") }, official2024: true },
  { id: "2020-president", year: 2020, office: "President", vest: { code: "PRE" }, nominees: { d: DEM("Joe Biden"), r: GOP("Donald J. Trump") } },
  { id: "2016-president", year: 2016, office: "President", vest: { code: "PRE" } },
  // The Statewide Database's SEN columns are California's state senate; USS is the U.S. Senate.
  { id: "2018-senate", year: 2018, office: "Senate", vest: { code: "USS" }, ca2018: { USSDEM02: DEM("Dianne Feinstein"), USSDEM01: DEM("Kevin de León") } },
  { id: "2018-governor", year: 2018, office: "Governor", vest: { code: "GOV" }, ca2018: { GOVDEM01: DEM("Gavin Newsom"), GOVREP01: GOP("John H. Cox") } },
  // Minnesota's and Mississippi's second seats. VEST codes a special election S and a runoff R; Mississippi's
  // November special went to a runoff, which decided the seat.
  { id: "2018-senate-special", year: 2018, office: "Senate", vest: { code: "USS", only: { MN: "S", MS: "R" } } },
];

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], maxBuffer: 1 << 30 });
const mapshaper = (args) => sh(process.execPath, [...MAPSHAPER, ...args, "-quiet"]);

async function download(url, path) {
  if (existsSync(path)) return;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

// ---- VEST ----

/** Downloads a VEST year's state files and documentation, unzipped, and returns the shapefile for each state. */
async function vestYear(year) {
  const dir = `${CACHE}/vest${year}`;
  mkdirSync(dir, { recursive: true });
  const meta = await (await fetch(`${DATAVERSE}/datasets/:persistentId/?persistentId=doi:10.7910/DVN/${VEST[year]}`)).json();
  const files = meta.data.latestVersion.files.map((f) => f.dataFile);
  const doc = files.find((f) => f.filename === "documentation.txt");
  await download(`${DATAVERSE}/access/datafile/${doc.id}`, `${dir}/documentation.txt`);
  const shapes = new Map();
  for (const f of files) {
    // One zip per state, named like "al_2016.zip" or "fl.zip"; skip the House, primary and special-election extras.
    const m = /^([a-z]{2})(_\d{4})?\.zip$/.exec(f.filename);
    if (!m) continue;
    const st = m[1].toUpperCase();
    const zip = `${dir}/${f.filename}`;
    await download(`${DATAVERSE}/access/datafile/${f.id}`, zip);
    const into = `${dir}/${st}`;
    if (!existsSync(into)) sh("unzip", ["-o", "-q", "-d", into, zip]);
    const shp = readdirSync(into, { recursive: true }).find((p) => String(p).endsWith(".shp"));
    if (shp) shapes.set(st, `${into}/${shp}`);
  }
  return { shapes, doc: readFileSync(`${dir}/documentation.txt`, "utf8") };
}

/**
 * Candidate names and parties by vote column for one state, from VEST's documentation ("G16PREDCLI - Hillary Clinton
 * (Democratic Party)"). A column the state's section leaves out (California lists none) takes the name another
 * state gives the same column, which holds for presidential candidates.
 */
function vestNames(doc, stateName) {
  const lines = doc.split(/\r?\n/);
  const isHeader = (i) => lines[i].trim() && /^-{3,}$/.test(lines[i + 1]?.trim() ?? "");
  const entry = (line) => /^([A-Z]\d\d[A-Z0-9]+)\s+-\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/i.exec(line.trim());
  const names = new Map();
  for (const line of lines) {
    const m = entry(line);
    if (m && !names.has(m[1].toUpperCase())) names.set(m[1].toUpperCase(), { name: m[2], partyName: m[3] ?? "" });
  }
  const start = lines.findIndex((l, i) => l.trim() === stateName && isHeader(i));
  if (start < 0) return names;
  for (let i = start + 2; i < lines.length && !isHeader(i); i++) {
    const m = entry(lines[i]);
    if (m) names.set(m[1].toUpperCase(), { name: m[2], partyName: m[3] ?? "" });
  }
  return names;
}

const PARTY_BY_LETTER = { D: "DEM", R: "GOP", L: "LIB", G: "GRE", I: "IND", C: "CST" };
function partyOf(letter, partyName) {
  if (PARTY_BY_LETTER[letter]) return PARTY_BY_LETTER[letter];
  const word = partyName.replace(/\bparty\b/i, "").trim();
  return word ? word.slice(0, 3).toUpperCase() : "IND";
}

/** Reads a shapefile's attribute table (.dbf): field names and each record's values. */
function readDbf(path) {
  const b = readFileSync(path);
  const count = b.readUInt32LE(4);
  const headerLength = b.readUInt16LE(8);
  const recordLength = b.readUInt16LE(10);
  const fields = [];
  for (let o = 32; b[o] !== 0x0d; o += 32) fields.push({ name: b.toString("latin1", o, o + 11).replace(/\0.*$/, ""), length: b[o + 16] });
  const records = [];
  for (let r = 0; r < count; r++) {
    let o = headerLength + r * recordLength + 1;
    const rec = {};
    for (const f of fields) {
      rec[f.name] = b.toString("latin1", o, o + f.length).replace(/\0/g, "").trim();
      o += f.length;
    }
    records.push(rec);
  }
  return { fields: fields.map((f) => f.name), records };
}

// Field names that hold a precinct's name, best first. VEST's states each use their own.
const NAME_FIELDS = [
  "PRECINCT_L", "WP_NAME", "LABEL", "ENR_DESC", "PRECNAME", "PRECINCTNA", "PCTNAME", "SOSPRECINC", "NAME20", "NAME18", "NAME16",
  "NAME10", "NAMELSAD", "P16", "P18", "NAME", "PRECINCT", "PRECINCT_N", "PRCCODE", "PREC", "SRPREC", "PCT_STD", "DISTRICT",
];

/**
 * Groups a state's vote columns for one office into candidates (New York lists a candidate once per party line) and
 * picks the three the map tells apart: the leading Democrat (`d`), Republican (`r`) and anyone else (`a`).
 */
function vestCandidates(fields, records, prefix, names) {
  const re = new RegExp(`^${prefix}([A-Z])([A-Z0-9]{3})$`, "i");
  const cols = fields.filter((f) => re.test(f));
  const byName = new Map();
  for (const col of cols) {
    const [, letter] = re.exec(col);
    const doc = names.get(col.toUpperCase());
    const writeIn = /write|^OWR|^OTH/i.test(doc?.name ?? col.slice(prefix.length));
    const name = writeIn ? "Write-ins" : doc?.name ?? col;
    const party = partyOf(letter.toUpperCase(), doc?.partyName ?? "");
    const c = byName.get(name) ?? { name, party, cols: [], votes: 0, writeIn };
    // A candidate on several lines takes the major party's.
    if (party === "DEM" || party === "GOP") c.party = party;
    c.cols.push(col);
    c.votes += records.reduce((s, rec) => s + (Number(rec[col]) || 0), 0);
    byName.set(name, c);
  }
  return slotCandidates([...byName.values()]);
}

/** Picks the map's three candidates from a state's list, sorted by votes. */
function slotCandidates(list) {
  const sorted = list.sort((a, b) => b.votes - a.votes);
  const named = sorted.filter((c) => !c.writeIn);
  const d = named.find((c) => c.party === "DEM");
  const r = named.find((c) => c.party === "GOP");
  const a = named.find((c) => c !== d && c !== r && c.votes > 0);
  return { cands: sorted, slots: { d, r, a } };
}

const sumExpr = (cols) => (cols.length ? cols.map((c) => `(+${c}||0)`).join("+") : "0");

/**
 * Writes a state's VEST precincts for one office as GeoJSON lines with the standard properties. Precincts with no
 * votes stay, so the map draws them gray instead of leaving holes.
 */
function vestState({ shp, st, fips, prefix, names, out }) {
  const { fields, records } = readDbf(shp.replace(/\.shp$/, ".dbf"));
  const { cands, slots } = vestCandidates(fields, records, prefix, names);
  if (!slots.d && !slots.r && !slots.a) return null;
  const nameField = NAME_FIELDS.find((f) => fields.includes(f));
  const countyField = COUNTY_FIELDS.find((f) => fields.includes(f) && records.filter((rec) => countyCode(fips, rec[f])).length >= 0.99 * records.length);
  const each = [
    `st='${st}'`,
    `nm=${nameField ? `String(${nameField})` : "''"}`,
    `d=${sumExpr(slots.d?.cols ?? [])}`,
    `r=${sumExpr(slots.r?.cols ?? [])}`,
    `a=${sumExpr(slots.a?.cols ?? [])}`,
    `t=${sumExpr(cands.flatMap((c) => c.cols))}`,
    ...(countyField ? [`co='${fips}' + String(${countyField}).replace(/\\D/g, '').padStart(3, '0').slice(-3)`] : []),
  ].join(", ");
  mapshaper([
    "-i", shp, "-proj", "wgs84", "-each", each,
    ...(countyField ? [] : ["-join", stateCounties(fips), "fields=co", "largest-overlap"]),
    "-filter-fields", "st,co,nm,d,r,a,t", "-o", out, "format=geojson", "ndjson", "precision=0.00001",
  ]);
  return { cands, slots };
}

// Fields that may hold a precinct's county FIPS code; one is used only if nearly every value names a county in the state.
const COUNTY_FIELDS = ["COUNTYFP", "COUNTYFP20", "COUNTYFP18", "COUNTYFP16", "COUNTYFP10", "COUNTYFIPS", "CNTY_FIPS", "COUNTY_FIP", "FIPS_CODE"];
const countyCode = (fips, value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits && COUNTY_NAMES.has(`${fips}${digits.padStart(3, "0").slice(-3)}`);
};

/**
 * A state's own counties (Census 1:500,000), for precincts whose file names no county: each takes the county it
 * overlaps most, and a precinct on a state line can't be matched to the county across it.
 */
function stateCounties(fips) {
  const file = `${CACHE}/counties-500k-${fips}.geojson`;
  if (!existsSync(file)) mapshaper(["-i", COUNTIES_500K, "-filter", `co.slice(0, 2) === '${fips}'`, "-o", file]);
  return file;
}

// ---- California 2018 (Statewide Database) ----

async function ca2018(columns, out) {
  const dir = `${CACHE}/ca2018`;
  mkdirSync(dir, { recursive: true });
  const csv = `${dir}/state_g18_sov_data_by_g18_srprec.csv`;
  const zip = `${dir}/srprec_state_g18_v01_shp.zip`;
  await download(`${SWDB_2018}/state_g18_sov_data_by_g18_srprec.csv`, csv);
  await download(`${SWDB_2018}/srprec_state_g18_v01_shp.zip`, zip);
  if (!existsSync(`${dir}/shp`)) sh("unzip", ["-o", "-q", "-d", `${dir}/shp`, zip]);
  const shp = `${dir}/shp/${readdirSync(`${dir}/shp`, { recursive: true }).find((p) => String(p).endsWith(".shp"))}`;
  const [head, ...rows] = readFileSync(csv, "utf8").trim().split(/\r?\n/).map((l) => l.split(","));
  const col = (name) => head.indexOf(name);
  // Every candidate column for this office starts with the office's code (SEN, GOV).
  const office = Object.keys(columns)[0].slice(0, 3);
  const all = head.filter((h) => h.startsWith(office) && /\d\d$/.test(h));
  const list = all.map((h) => ({ ...(columns[h] ?? { name: h, party: "IND" }), cols: [h], votes: rows.reduce((s, r) => s + (Number(r[col(h)]) || 0), 0) }));
  const { cands, slots } = slotCandidates(list);
  // The shapefile has no .prj, but its coordinates are already longitude and latitude.
  mapshaper([
    "-i", shp,
    "-join", csv, "keys=SRPREC_KEY,SRPREC_KEY", "string-fields=SRPREC_KEY",
    "-each", [`st='CA'`, `nm=String(SRPREC)`, `co=String(SRPREC_KEY).slice(0,5)`, `d=${sumExpr(slots.d?.cols ?? [])}`, `r=${sumExpr(slots.r?.cols ?? [])}`, `a=${sumExpr(slots.a?.cols ?? [])}`, `t=${sumExpr(all)}`].join(", "),
    "-filter-fields", "st,co,nm,d,r,a,t", "-o", out, "format=geojson", "ndjson", "precision=0.00001",
  ]);
  return { cands, slots };
}

// ---- NYT ----

/** Writes the NYT's 2024 precincts as GeoJSON lines, one part per state. */
async function nyt2024(out, parts) {
  const nameOf = `nm=GEOID.slice(6).replace(/_/g, '.')`;
  const votes = `co=GEOID.slice(0,5), d=votes_dem, r=votes_rep, a=0, t=votes_total`;
  // The national file is too big to read in one piece; the NYT also publishes it state by state.
  mkdirSync(`${CACHE}/nyt2024`, { recursive: true });
  for (const [, st] of STATES) {
    const topo = `${CACHE}/nyt2024/${st}.topojson`;
    if (!existsSync(topo)) {
      const res = await fetch(NYT_2024(st));
      if (!res.ok) {
        console.warn(`NYT has no 2024 file for ${st} (HTTP ${res.status})`);
        continue;
      }
      const gz = `${topo}.gz`;
      writeFileSync(gz, Buffer.from(await res.arrayBuffer()));
      sh("gunzip", ["-f", gz]);
    }
    const file = `${out}.nyt-${st}.geojsonl`;
    mapshaper(["-i", topo, "-each", `${votes}, st='${st}', ${nameOf}`, "-filter", "t > 0", "-filter-fields", "st,co,nm,d,r,a,t", "-o", file, "format=geojson", "ndjson", "precision=0.00001"]);
    parts.push(file);
  }
}

// ---- 2024 official totals ----
//
// The NYT's precincts leave out Alaska, a few whole counties (Oklahoma and Tulsa among them) and some towns, so the
// 2024 map's counties and states carry official totals instead of the precincts' sums: counties are Census shapes, with
// each state's county votes from whichever source comes closer to its official total, MEDSL's precinct returns or
// tonmcg's county results (each falls short somewhere); states take MEDSL's official totals. The map draws counties
// under the precincts, so where a precinct is missing its county shows through.

/** Splits a CSV line, keeping commas inside quotes. */
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

async function eachCsvRow(path, onRow) {
  let head;
  let pending = "";
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    // A quoted cell can hold a line break ("PETER\nSONSKI"); read on until the quotes close.
    pending = pending ? `${pending} ${line}` : line;
    if ((pending.match(/"/g)?.length ?? 0) % 2) continue;
    const row = pending;
    pending = "";
    if (!row.trim()) continue;
    const cells = csvCells(row);
    if (!head) head = cells;
    else onRow(Object.fromEntries(head.map((k, i) => [k, cells[i]])));
  }
}

/** MEDSL rows that are no one's votes: under- and overvotes, blanks and running totals. */
const NOT_VOTES = /^(UNDER ?VOTES?|OVER ?VOTES?|UNDERVOTES-VOIDS|TOTAL .*|CONTEST TOTAL|CAST VOTES|BLANKS?|BLANK BALLOTS|INVALID( VOTES)?|VOID|SPOILED|UNDECIDED|MISC|)$/;
/** Old county codes some sources still use: South Dakota's Shannon County became Oglala Lakota in 2015. */
const RENAMED = { 46113: "46102" };
const addVotes = (map, code, candidate, votes) => {
  const key = RENAMED[code] ?? code;
  const v = map.get(key) ?? { d: 0, r: 0, a: 0, t: 0 };
  if (/HARRIS/.test(candidate)) v.d += votes;
  else if (/TRUMP/.test(candidate)) v.r += votes;
  v.t += votes;
  map.set(key, v);
};

/** An Alaska row's House district as a county code: from its district's code, or its name ("District 2 - Absentee"). */
function alaskaDistrict(row) {
  const n = Number(String(row.jurisdiction_fips).slice(-2)) || Number(/^District (\d+)\b/.exec(row.precinct)?.[1]);
  return n >= 1 && n <= 40 ? `029${String(n).padStart(2, "0")}` : "";
}

/** County totals from MEDSL's precinct returns; Alaska's by House district. */
async function medslCounties() {
  const dir = `${CACHE}/medsl2024`;
  mkdirSync(dir, { recursive: true });
  // A precinct some states report both as a total and by voting method counts once, by its total.
  const rows = new Map();
  for (const [, st] of STATES) {
    const name = `${st.toLowerCase()}24`;
    await download(`${MEDSL_2024}/individual_states/${name}.zip`, `${dir}/${name}.zip`);
    if (!existsSync(`${dir}/${name}`)) sh("unzip", ["-o", "-q", "-d", `${dir}/${name}`, `${dir}/${name}.zip`]);
    const csv = readdirSync(`${dir}/${name}`).find((f) => f.endsWith(".csv"));
    await eachCsvRow(`${dir}/${name}/${csv}`, (c) => {
      if (c.office !== "US PRESIDENT" || NOT_VOTES.test(c.candidate)) return;
      const co = st === "AK" ? alaskaDistrict(c) : c.county_fips;
      if (!/^\d{5}$/.test(co)) return;
      const key = [co, c.jurisdiction_fips, c.precinct, c.candidate].join("|");
      const row = rows.get(key) ?? { co, candidate: c.candidate, total: null, modes: 0 };
      if (c.mode === "TOTAL") row.total = (row.total ?? 0) + (Number(c.votes) || 0);
      else row.modes += Number(c.votes) || 0;
      rows.set(key, row);
    });
  }
  const counties = new Map();
  for (const row of rows.values()) addVotes(counties, row.co, row.candidate, row.total ?? row.modes);
  return counties;
}

async function tonmcgCounties() {
  const file = `${CACHE}/medsl2024/tonmcg-2024.csv`;
  await download(TONMCG_2024, file);
  const counties = new Map();
  await eachCsvRow(file, (c) => {
    const d = Number(c.votes_dem) || 0, r = Number(c.votes_gop) || 0;
    const co = String(c.county_fips).padStart(5, "0");
    counties.set(RENAMED[co] ?? co, { d, r, a: 0, t: Number(c.total_votes) || 0 });
  });
  return counties;
}

/** Each state's official totals, and its counties' votes from the closer of the two county sources. */
async function official2024() {
  const file = `${CACHE}/medsl2024/president-state.csv`;
  await download(`${MEDSL_2024}/2024-president-state.csv`, file);
  const states = new Map();
  await eachCsvRow(file, (c) => {
    if (!NOT_VOTES.test(c.candidate)) addVotes(states, c.state_po, c.candidate, Number(c.votes) || 0);
  });
  const sources = [await medslCounties(), await tonmcgCounties()];
  // Only codes the map has shapes for count (MEDSL gives Connecticut's old counties, the map its planning regions).
  const shapes = new Set([...stateShapes2024().map((f) => f.properties.co), ...AK_DISTRICTS.map(([co]) => co)]);
  const counties = new Map();
  for (const [st, official] of states) {
    const fips = STATES.find((s) => s[1] === st)[0];
    const inState = (source) => [...source].filter(([co]) => co.startsWith(fips) && shapes.has(co));
    const gap = (source) => Math.abs(inState(source).reduce((n, [, v]) => n + v.t, 0) - official.t);
    const best = sources.reduce((a, b) => (gap(b) < gap(a) ? b : a));
    for (const [co, v] of inState(best)) counties.set(co, v);
    console.log(`2024 ${st}: counties ${gap(best) ? `${((gap(best) / official.t) * 100).toFixed(2)}% off` : "match"} the official total (${best === sources[0] ? "MEDSL" : "tonmcg"})`);
  }
  return { states, counties };
}

/** The 2023 Census counties of the states and DC, leaving out the territories and Alaska's boroughs. */
function stateShapes2024() {
  return JSON.parse(readFileSync(COUNTIES_2023, "utf8")).features.filter((f) => STATE_BY_FIPS.has(f.properties.co.slice(0, 2)) && !f.properties.co.startsWith("02"));
}

/** Alaska's House districts (Census 2023, the 2022 plan) as GeoJSON, each with its county code. */
async function alaskaDistricts() {
  const file = `${CACHE}/census/ak-districts.geojson`;
  if (!existsSync(file)) {
    const zip = `${CACHE}/census/cb_2023_02_sldl_500k.zip`;
    await download(`${CENSUS}/GENZ2023/shp/cb_2023_02_sldl_500k.zip`, zip);
    sh("unzip", ["-o", "-q", "-d", `${CACHE}/census/ak-sldl`, zip]);
    mapshaper(["-i", `${CACHE}/census/ak-sldl/cb_2023_02_sldl_500k.shp`, "-proj", "wgs84", "-each", "co='029' + String(SLDLST).slice(-2)", "-filter-fields", "co", "-o", file]);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Writes the 2024 counties (Census shapes with their votes) and Alaska's districts as precincts, since the NYT has
 * none there. Returns the parts' path.
 */
async function counties2024(counties, file, akPart) {
  const districts = await alaskaDistricts();
  const props = (co) => ({ st: STATE_BY_FIPS.get(co.slice(0, 2)), co, cn: COUNTY_NAMES.get(co) ?? "", ...(counties.get(co) ?? { d: 0, r: 0, a: 0, t: 0 }) });
  const features = [...stateShapes2024(), ...districts.features].map((f) => ({ ...f, properties: props(f.properties.co) }));
  writeFileSync(file, JSON.stringify({ type: "FeatureCollection", features }));
  writeFileSync(akPart, districts.features.map((f) => JSON.stringify({ ...f, properties: { ...props(f.properties.co), nm: `House ${COUNTY_NAMES.get(f.properties.co)}` } })).join("\n") + "\n");
}

// ---- Assembly ----

/** A code-like name ("6737", "AP0002") reads as "Precinct 6737". */
function precinctName(raw) {
  const name = String(raw ?? "").trim();
  if (!name) return "Precinct";
  return /^[\w.-]+$/.test(name) && /\d/.test(name) ? `Precinct ${name}` : name;
}

/**
 * Joins the parts into one GeoJSON file of precincts, naming each one's county, and totals the votes by state
 * (for states whose candidates came from the NYT's two-party counts).
 */
async function assemble(parts, file) {
  const out = createWriteStream(file);
  const totals = new Map();
  out.write('{"type":"FeatureCollection","features":[\n');
  let first = true;
  for (const part of parts) {
    for await (const line of createInterface({ input: createReadStream(part), crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      const f = JSON.parse(line);
      const p = f.properties;
      // A code that names no county (a stray value in a VEST county column) leaves the precinct out of the counties.
      const co = p.co ? String(p.co).padStart(5, "0") : "";
      p.co = COUNTY_NAMES.has(co) ? co : "";
      p.cn = COUNTY_NAMES.get(p.co) ?? "";
      p.nm = precinctName(p.nm);
      for (const k of ["d", "r", "a", "t"]) p[k] = Math.round(Number(p[k]) || 0);
      const s = totals.get(p.st) ?? { d: 0, r: 0, a: 0, t: 0 };
      for (const k of ["d", "r", "a", "t"]) s[k] += p[k];
      totals.set(p.st, s);
      if (!out.write((first ? "" : ",\n") + JSON.stringify(f))) await new Promise((r) => out.once("drain", r));
      first = false;
    }
  }
  out.write("\n]}\n");
  await new Promise((r) => out.end(r));
  return totals;
}

/** Spells the major-party nominees one way ("Joseph Biden" → "Joe Biden"), as the other elections do. */
function withNominees({ cands, slots }, nominees) {
  const rename = (c) => (c?.party === "DEM" ? { ...c, name: nominees.d.name } : c?.party === "GOP" ? { ...c, name: nominees.r.name } : c);
  return { cands: cands.map(rename), slots: { d: rename(slots.d), r: rename(slots.r), a: slots.a } };
}

const pick = (c) => (c ? { name: c.name, party: c.party } : undefined);

async function build(election) {
  const dir = `${CACHE}/out/${election.id}`;
  mkdirSync(dir, { recursive: true });
  const parts = [];
  const states = {};
  if (election.nyt) await nyt2024(`${dir}/part`, parts);
  const official = election.official2024 ? await official2024() : null;
  if (official) {
    parts.push(`${dir}/part.ak.geojsonl`);
    await counties2024(official.counties, `${dir}/counties.geojson`, `${dir}/part.ak.geojsonl`);
  }
  if (election.vest) {
    const { shapes, doc } = await vestYear(election.year);
    const { code, only } = election.vest;
    for (const [fips, st, name] of STATES) {
      const shp = shapes.get(st);
      // VEST codes DC's "shadow senator", who has no seat, as a Senate race.
      if (!shp || (st === "DC" && code !== "PRE") || (only && !only[st])) continue;
      const prefix = `${only?.[st] ?? "G"}${String(election.year).slice(2)}${code}`;
      const out = `${dir}/part.vest-${st}.geojsonl`;
      const got = vestState({ shp, st, fips, prefix, names: vestNames(doc, name), out });
      if (!got) continue;
      parts.push(out);
      states[st] = election.nominees ? withNominees(got, election.nominees) : got;
    }
  }
  if (election.ca2018) {
    const out = `${dir}/part.ca.geojsonl`;
    states.CA = await ca2018(election.ca2018, out);
    parts.push(out);
  }

  console.log(`${election.id}: assembling ${parts.length} parts`);
  const precincts = `${dir}/precincts.geojson`;
  const totals = await assemble(parts, precincts);

  // Counties and states are otherwise the precincts dissolved, so their edges match the precincts' exactly.
  if (!official) mapshaper(["-i", precincts, "-filter", "co !== ''", "-dissolve", "co", "copy-fields=st,cn", "sum-fields=d,r,a,t", "-o", `${dir}/counties.geojson`, "precision=0.00001"]);
  mapshaper(["-i", official ? `${dir}/counties.geojson` : precincts, "-dissolve", "st", "sum-fields=d,r,a,t", "-o", `${dir}/states.geojson`, "precision=0.00001"]);
  if (official) {
    const states = JSON.parse(readFileSync(`${dir}/states.geojson`, "utf8"));
    for (const f of states.features) Object.assign(f.properties, official.states.get(f.properties.st));
    writeFileSync(`${dir}/states.geojson`, JSON.stringify(states));
  }

  // The sidebar's summary: each state's candidates, and which three the map tells apart.
  const summary = {};
  for (const [st, s] of official?.states ?? totals) {
    const named = states[st];
    if (named) {
      const others = named.cands.filter((c) => c.writeIn).reduce((n, c) => n + c.votes, 0);
      summary[st] = {
        slots: { d: pick(named.slots.d), r: pick(named.slots.r), a: pick(named.slots.a) },
        cands: [...named.cands.filter((c) => !c.writeIn && c.votes > 0).map((c) => ({ ...pick(c), votes: c.votes })), ...(others ? [{ name: "Write-ins", party: "", votes: others }] : [])],
        total: s.t,
      };
    } else {
      const { d, r } = election.nyt;
      summary[st] = { slots: { d, r }, cands: [{ ...d, votes: s.d }, { ...r, votes: s.r }, { name: "Others", party: "", votes: s.t - s.d - s.r }], total: s.t };
    }
  }

  const tiles = `${CACHE}/tiles`;
  mkdirSync(tiles, { recursive: true });
  sh("tippecanoe", [
    "-o", `${tiles}/${election.id}.pmtiles`, "--force", "-Z", "2", "-z", "11",
    "-L", `precincts:${precincts}`, "-L", `counties:${dir}/counties.geojson`, "-L", `states:${dir}/states.geojson`,
    "--generate-ids", "--detect-shared-borders", "--coalesce-densest-as-needed", "--extend-zooms-if-still-dropping",
    ...["d", "r", "a", "t"].map((k) => `--accumulate-attribute=${k}:sum`),
    "--quiet",
  ]);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${election.id}.json`, JSON.stringify({ id: election.id, year: election.year, office: election.office, states: summary }));
  console.log(`${election.id}: ${totals.size} states, ${[...totals.values()].reduce((n, s) => n + s.t, 0).toLocaleString()} votes`);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(`${CACHE}/census`, { recursive: true });
  for (const [year, file] of [[2020, COUNTIES_500K], [2023, COUNTIES_2023]]) {
    if (existsSync(file)) continue;
    const zip = `${CACHE}/census/cb_${year}_us_county_500k.zip`;
    await download(`${CENSUS}/GENZ${year}/shp/cb_${year}_us_county_500k.zip`, zip);
    sh("unzip", ["-o", "-q", "-d", `${CACHE}/census/counties-${year}`, zip]);
    mapshaper(["-i", `${CACHE}/census/counties-${year}/cb_${year}_us_county_500k.shp`, "-proj", "wgs84", "-each", "co=GEOID", "-filter-fields", "co", "-o", file, "precision=0.00001"]);
  }
  const wanted = process.argv.slice(2);
  for (const election of ELECTIONS) if (!wanted.length || wanted.includes(election.id)) await build(election);
}

await main();
