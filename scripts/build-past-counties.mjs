// Builds lib/midterms/pastCounties.json: each county's Democratic-minus-Republican margin, in points, in recent
// elections other than 2024's presidential race (that one is lib/midterms/baseline2024.json), for the race map's
// Swing view to compare against.
//
//   node scripts/build-past-counties.mjs
//
// Sources download into .cache/past-counties/ on the first run:
//   2020 president: github.com/tonmcg/US_County_Level_Election_Results_08-24.
//   2022 Senate and governor: MEDSL's official precinct returns, github.com/MEDSL/2022-elections-official, summed by county.
//   2024 Senate: MEDSL's county returns, github.com/MEDSL/2024-elections-official.
// A state's election is left out when the Republican's main opponent wasn't a Democrat (Utah's 2022 Senate race, Maine's
// in 2024), and special elections are left out. Gaps in MEDSL's files: California's 2022 file has no Senate race and Tennessee's no
// governor's race, and Alaska's rows have no county.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ROOT = new URL("../", import.meta.url).pathname;
const CACHE = `${ROOT}.cache/past-counties`;
const OUT = `${ROOT}lib/midterms/pastCounties.json`;
const TONMCG_2020 = "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2020_US_County_Level_Presidential_Results.csv";
const MEDSL_2022 = "https://raw.githubusercontent.com/MEDSL/2022-elections-official/main/individual_states";
const MEDSL_2024_SENATE = "https://raw.githubusercontent.com/MEDSL/2024-elections-official/main/2024-senate-county.csv";
const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
const OFFICES_2022 = { "US SENATE": "2022-senate", GOVERNOR: "2022-governor" };
/**
 * MEDSL rows that are no one's votes: under- and overvotes, blanks and running totals, and New York's ballot counters
 * ("PUBLIC COUNTER", "ABSENTEE / MILITARY"), filed as candidates.
 */
const NOT_VOTES = /^(UNDER ?VOTES?|OVER ?VOTES?|UNDERVOTES-VOIDS|TOTAL .*|CONTEST TOTAL|CAST VOTES|BLANKS?|BLANK BALLOTS|BLANK\/VOID|INVALID( VOTES)?|VOID|SPOILED|UNDECIDED|MISC|PUBLIC COUNTER|ABSENTEE( \/ MILITARY)?|MILITARY|AFFIDAVIT|FEDERAL|EMERGENCY|PROVISIONAL|BALLOTS CAST|REGISTERED VOTERS|)$/;
/** Old county codes some sources still use: South Dakota's Shannon County became Oglala Lakota in 2015. */
const RENAMED = { 46113: "46102" };

async function download(url, path) {
  if (existsSync(path)) return;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

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
    // A quoted cell can hold a line break; read on until the quotes close.
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

const isTrue = (s) => /^true$/i.test(s ?? "");
const fipsOf = (s) => {
  const code = String(s ?? "").padStart(5, "0");
  return /^\d{5}$/.test(code) && code !== "00000" ? (RENAMED[code] ?? code) : null;
};

/**
 * Nominees MEDSL's files give no party or the wrong one: New Mexico's 2022 governor's race has no parties at all, and
 * Wyoming's lists the Democrat, Theresa Livingston, as a Libertarian.
 */
const PARTY_FIX = { "MICHELLE LUJAN GRISHAM": "D", "MARK V RONCHETTI": "R", "THERESA A LIVINGSTON": "D" };

/** D, R or null for a MEDSL row, reading party_detailed where party_simplified files a Democrat under OTHER (ND's NPL, MN's DFL, WA's "GOP"). */
function partyOf(c) {
  if (PARTY_FIX[c.candidate]) return PARTY_FIX[c.candidate];
  if (c.party_simplified === "DEMOCRAT" || /^DEMOCRAT/.test(c.party_detailed ?? "")) return "D";
  if (c.party_simplified === "REPUBLICAN" || /^(REPUBLICAN|GOP)$/.test(c.party_detailed ?? "")) return "R";
  return null;
}

/** County votes as { d, r, t }, added into `map` under `fips`. */
function add(map, fips, party, votes) {
  const v = map.get(fips) ?? { d: 0, r: 0, t: 0 };
  map.set(fips, { d: v.d + (party === "D" ? votes : 0), r: v.r + (party === "R" ? votes : 0), t: v.t + votes });
}

/** Margins in points, one decimal, for counties in the `states` given (all of them when null). */
function margins(counties, states = null) {
  const byState = new Map();
  for (const [fips, v] of counties) {
    const st = fips.slice(0, 2);
    const s = byState.get(st) ?? { d: 0, r: 0, t: 0 };
    byState.set(st, { d: s.d + v.d, r: s.r + v.r, t: s.t + v.t });
  }
  // PAST_AUDIT=1 prints each state's margin, to check against certified results.
  if (process.env.PAST_AUDIT) console.log([...byState].filter(([st]) => !states || states.has(st)).map(([st, s]) => `${st} ${(((s.d - s.r) / s.t) * 100).toFixed(1)}`).join("  "));
  const out = {};
  for (const [fips, v] of [...counties].sort(([a], [b]) => a.localeCompare(b))) {
    if (v.t > 0 && (!states || states.has(fips.slice(0, 2)))) out[fips] = Math.round(((v.d - v.r) / v.t) * 1000) / 10;
  }
  return out;
}

async function president2020() {
  const file = `${CACHE}/tonmcg-2020.csv`;
  await download(TONMCG_2020, file);
  const counties = new Map();
  await eachCsvRow(file, (c) => {
    const fips = fipsOf(c.county_fips);
    const t = Number(c.total_votes) || 0;
    if (fips && t) counties.set(fips, { d: Number(c.votes_dem) || 0, r: Number(c.votes_gop) || 0, t });
  });
  return margins(counties);
}

async function senate2024() {
  const file = `${CACHE}/medsl-2024-senate-county.csv`;
  await download(MEDSL_2024_SENATE, file);
  // A county some states report both as a total and by voting method counts once, by its total.
  const rows = new Map();
  await eachCsvRow(file, (c) => {
    if (c.stage !== "GEN" || isTrue(c.special) || NOT_VOTES.test(c.candidate)) return;
    const fips = fipsOf(c.county_fips);
    if (!fips) return;
    tally(rows, [fips, c.candidate].join("|"), fips, c.candidate, partyOf(c), c.mode, c.votes);
  });
  return marginsOf(rows);
}

/** One candidate's votes in a precinct or county; a fusion candidate's party lines add up, under their D or R line. */
function tally(rows, key, fips, candidate, party, mode, votes) {
  const row = rows.get(key) ?? { fips, candidate, party: null, total: null, modes: 0 };
  const n = Number(votes) || 0;
  const next = { ...row, party: row.party ?? party };
  rows.set(key, mode === "TOTAL" ? { ...next, total: (row.total ?? 0) + n } : { ...next, modes: row.modes + n });
}

/**
 * County margins from tallied rows, for states where the Democrat ran second to the Republican or better than every
 * other candidate: not Nebraska's or Maine's 2024 Senate races, where an independent was the Republican's opponent.
 */
function marginsOf(rows) {
  const counties = new Map();
  const party = new Map();
  const byCandidate = new Map();
  for (const row of rows.values()) {
    const key = `${row.fips.slice(0, 2)}|${row.candidate}`;
    if (row.party) party.set(key, row.party);
    byCandidate.set(key, (byCandidate.get(key) ?? 0) + (row.total ?? row.modes));
  }
  for (const row of rows.values()) add(counties, row.fips, party.get(`${row.fips.slice(0, 2)}|${row.candidate}`) ?? null, row.total ?? row.modes);
  const best = new Map();
  for (const [key, votes] of byCandidate) {
    const [st] = key.split("|");
    const side = party.get(key) ?? "O";
    const b = best.get(st) ?? { D: 0, R: 0, O: 0 };
    best.set(st, { ...b, [side]: Math.max(b[side], votes) });
  }
  const states = new Set([...best].filter(([, b]) => b.D > 0 && b.R > 0 && b.D >= b.O).map(([st]) => st));
  return margins(counties, states);
}

async function midterm2022() {
  const dir = `${CACHE}/medsl2022`;
  mkdirSync(dir, { recursive: true });
  const rows = Object.fromEntries(Object.values(OFFICES_2022).map((id) => [id, new Map()]));
  for (const st of STATES) {
    const name = `2022-${st.toLowerCase()}-local-precinct-general`;
    await download(`${MEDSL_2022}/${name}.zip`, `${dir}/${name}.zip`);
    if (!existsSync(`${dir}/${name}`)) execFileSync("unzip", ["-o", "-q", "-d", `${dir}/${name}`, `${dir}/${name}.zip`]);
    const csv = readdirSync(`${dir}/${name}`).find((f) => f.endsWith(".csv"));
    await eachCsvRow(`${dir}/${name}/${csv}`, (c) => {
      const id = OFFICES_2022[c.office];
      if (!id || c.stage !== "GEN" || isTrue(c.special) || NOT_VOTES.test(c.candidate)) return;
      const fips = fipsOf(c.county_fips);
      if (!fips) return;
      tally(rows[id], [fips, c.jurisdiction_fips, c.precinct, c.candidate].join("|"), fips, c.candidate, partyOf(c), c.mode, c.votes);
    });
  }
  return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, marginsOf(r)]));
}

mkdirSync(CACHE, { recursive: true });
const out = { "2020-president": await president2020(), ...(await midterm2022()), "2024-senate": await senate2024() };
writeFileSync(OUT, JSON.stringify(out));
for (const [id, counties] of Object.entries(out)) {
  const states = new Set(Object.keys(counties).map((f) => f.slice(0, 2)));
  console.log(`${id}: ${Object.keys(counties).length} counties in ${states.size} states`);
}
