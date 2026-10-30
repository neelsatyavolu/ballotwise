// Fits the forecast's fundamentals on past elections and writes lib/midterms/fit.json, the way DDHQ fits its own
// (votes-docs.decisiondeskhq.com/forecast-methodology): each race's two-party margin regressed on the seat's partisan
// lean, the national environment, incumbency and fundraising, separately for House and Senate.
//
//   margin = a + b·lean + c·environment + d·incumbent + e·fundraising
//
//   margin       Democrat minus Republican, share of the two-party vote, in points.
//   lean         the seat's previous presidential margin minus that election's national margin (2016 for 2018 and
//                2020, 2020 for 2022 and 2024), on the district lines used that year.
//   environment  that year's national House vote margin (Democrats minus Republicans). At forecast time the generic
//                ballot average stands in for it, and its own polling miss is added to the uncertainty.
//   incumbent    +1 when the Democrat is the incumbent, −1 for the Republican, 0 for an open seat (FEC's flag).
//   fundraising  ln(Democrat's receipts / Republican's), capped at ±3; 0 when either is missing from FEC's summary.
//
// Each cycle is backtested from a fit on the other three (leave one cycle out); σ is the out-of-sample root mean
// square error. Races without both a Democrat and a Republican, or where a party ran two serious candidates (top-two,
// jungle and ranked-choice fields), are left out.
//
// Sources: MIT Election Data and Science Lab House, Senate and President returns (Harvard Dataverse, CC0);
// The Downballot's presidential results by congressional district for each map; FEC candidate summaries (weball).
// Run with `node scripts/fit-forecast.mjs`. It also writes lib/midterms/fec2026.json, this cycle's receipts per race.
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const UA = "Ballotwise/1.0 (https://ballotwise.xanom.co; forecast fit)";
const get = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res;
};
/**
 * MEDSL's files sit behind Dataverse's guestbook, which the API accepts as a JSON response before handing back a
 * signed download link. We identify the project with the contact address published on the site.
 */
async function dataverse(id) {
  const body = { guestbookResponse: { name: "Ballotwise", email: "neel@xanom.co", institution: "Ballotwise", position: "Election forecast (fit-forecast.mjs)", answers: [] } };
  const res = await fetch(`https://dataverse.harvard.edu/api/access/datafile/${id}`, { method: "POST", headers: { "user-agent": UA, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Dataverse file ${id} returned ${res.status}`);
  return get((await res.json()).data.signedUrl);
}
const MEDSL = { house: 13592823, senate: 13887039, president: 13887042 };
const SHEET = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
/** The Downballot's sheets: [cycle, sheet, tab, columns of the prior election's D and R shares]. */
const DISTRICT_PRES = [
  [2018, "1zLNAuRqPauss00HDz4XbTH2HqsCzMe0pR8QmD1K8jk8", "0", [3, 4]],
  [2020, "1XbUXnI9OyfAuhP5P3vWtMuGc5UJlrhXbzZo3AwMuHtk", "0", [5, 6]],
  [2022, "1CKngqOp8fzU22JOlypoxNsxL6KSAH920Whc-rd7ebuM", "1871835782", [3, 4]],
  [2024, "1ng1i_Dm_RMDnEvauH44pgE6JCUsapcuu8F2pCfeLWFo", "620838163", [6, 7]],
];
const CYCLES = [2018, 2020, 2022, 2024];
const PRIOR_PRES = { 2018: 2016, 2020: 2016, 2022: 2020, 2024: 2020, 2026: 2024 };
const FUND_CAP = 3;
const RACES_URL = process.env.RACES_URL ?? "https://ballotwise.xanom.co/api/midterms";

// ---------- Parsing ----------

function csvFields(line, sep = ",") {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
/**
 * Rows of a MEDSL file as objects. The separator is whatever the header uses; the House file wraps each whole row in
 * quotes, which are stripped first. Rows that don't split into as many fields as the header (a comma inside a name
 * in an unquoted row) are dropped.
 */
function table(text) {
  const [head, ...rows] = text.split(/\r?\n/).filter(Boolean);
  const sep = head.includes("\t") ? "\t" : ",";
  const cols = csvFields(head, sep).map((c) => c.replace(/"/g, ""));
  const out = [];
  for (let r of rows) {
    if (sep === "," && /^".*"$/.test(r) && !r.slice(1, -1).includes('"')) r = r.slice(1, -1);
    const f = csvFields(r, sep);
    if (f.length !== cols.length) continue;
    out.push(Object.fromEntries(f.map((v, i) => [cols[i], v.replace(/^"|"$/g, "")])));
  }
  return out;
}
const yes = (v) => /^true$/i.test(v ?? "");
const general = (r) => !r.stage || /^gen$/i.test(r.stage);
/** The single file inside a zip archive (FEC's bulk downloads), via the central directory. */
function unzipOne(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(data) : data).toString("latin1");
}
const lastName = (name) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/"[^"]*"/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
    .trim()
    .split(/\s+/)
    .at(-1) ?? "";
/** FEC writes names "LAST, FIRST MIDDLE". */
const fecLast = (name) => lastName((name.split(",")[0] ?? name).trim());
const sideOf = (party) => (/^democrat/i.test(party) ? "D" : /^republican/i.test(party) ? "R" : null);

// ---------- Results ----------

/**
 * Two-party contests from MEDSL returns: one row per race with the Democrat's and Republican's names and votes.
 * A candidate's votes on every line they ran on (New York's fusion tickets) count toward them.
 */
function contests(rows, office) {
  const races = new Map();
  // Where a race reports votes by mode as well as a total, only the total rows count.
  const hasTotal = new Set(rows.filter((r) => /^total$/i.test(r.mode ?? "")).map((r) => `${r.year}|${r.state_po}|${r.district}|${r.special}`));
  for (const r of rows) {
    if (!general(r) || yes(r.writein) || !r.candidate) continue;
    if (hasTotal.has(`${r.year}|${r.state_po}|${r.district}|${r.special}`) && !/^total$/i.test(r.mode ?? "")) continue;
    const year = Number(r.year);
    if (!CYCLES.includes(year)) continue;
    const district = office === "house" ? Number(r.district) : yes(r.special) ? "special" : "";
    const key = `${year}|${r.state_po}|${district}`;
    const race = races.get(key) ?? { year, state: r.state_po, district, candidates: new Map(), total: 0 };
    const c = race.candidates.get(r.candidate) ?? { name: r.candidate, side: null, votes: 0 };
    c.votes += Number(r.candidatevotes) || 0;
    c.side ??= sideOf(r.party_simplified ?? r.party ?? "");
    race.candidates.set(r.candidate, c);
    races.set(key, race);
  }
  const out = [];
  for (const race of races.values()) {
    const list = [...race.candidates.values()];
    const total = list.reduce((s, c) => s + c.votes, 0);
    const serious = (side) => list.filter((c) => c.side === side && c.votes / total > 0.1);
    const d = list.filter((c) => c.side === "D").sort((a, b) => b.votes - a.votes)[0];
    const r = list.filter((c) => c.side === "R").sort((a, b) => b.votes - a.votes)[0];
    if (!d || !r || serious("D").length > 1 || serious("R").length > 1) continue;
    if (d.votes / total < 0.05 || r.votes / total < 0.05) continue;
    out.push({ year: race.year, state: race.state, district: race.district, dName: d.name, rName: r.name, margin: ((d.votes - r.votes) / (d.votes + r.votes)) * 100 });
  }
  return out;
}

/** Democrat-minus-Republican margin of the national House vote, from every general-election House race that year. */
function nationalHouse(rows) {
  const by = {};
  const hasTotal = new Set(rows.filter((r) => /^total$/i.test(r.mode ?? "")).map((r) => `${r.year}|${r.state_po}|${r.district}`));
  for (const r of rows) {
    if (!general(r)) continue;
    if (hasTotal.has(`${r.year}|${r.state_po}|${r.district}`) && !/^total$/i.test(r.mode ?? "")) continue;
    const y = Number(r.year);
    const t = (by[y] ??= { d: 0, r: 0, all: 0 });
    const side = sideOf(r.party ?? "");
    const v = Number(r.candidatevotes) || 0;
    if (side === "D") t.d += v;
    if (side === "R") t.r += v;
    t.all += v;
  }
  return Object.fromEntries(Object.entries(by).map(([y, t]) => [y, ((t.d - t.r) / t.all) * 100]));
}

/** Presidential margins by state and nationally, per election year. */
function presidential(rows) {
  const state = {};
  const nation = {};
  for (const r of rows) {
    const y = Number(r.year);
    const side = sideOf(r.party_simplified ?? "");
    const s = ((state[y] ??= {})[r.state_po] ??= { d: 0, r: 0, all: Number(r.totalvotes) || 0 });
    const n = (nation[y] ??= { d: 0, r: 0 });
    const v = Number(r.candidatevotes) || 0;
    if (side === "D") {
      s.d += v;
      n.d += v;
    }
    if (side === "R") {
      s.r += v;
      n.r += v;
    }
  }
  const totals = {};
  for (const [y, states] of Object.entries(state)) totals[y] = Object.values(states).reduce((t, s) => t + s.all, 0);
  return {
    state: Object.fromEntries(Object.entries(state).map(([y, states]) => [y, Object.fromEntries(Object.entries(states).map(([st, s]) => [st, ((s.d - s.r) / s.all) * 100]))])),
    nation: Object.fromEntries(Object.entries(nation).map(([y, n]) => [y, ((n.d - n.r) / totals[y]) * 100])),
  };
}

// ---------- Fundraising and incumbency (FEC) ----------

/** FEC's candidate summary: receipts and incumbency flag per candidate, keyed by office, state and district. */
async function fec(cycle) {
  const text = unzipOne(Buffer.from(await (await get(`https://www.fec.gov/files/bulk-downloads/${cycle}/weball${String(cycle).slice(2)}.zip`)).arrayBuffer()));
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const f = line.split("|");
    if (f.length < 20) continue;
    const office = f[0][0] === "H" ? "house" : f[0][0] === "S" ? "senate" : null;
    const side = f[4] === "DEM" ? "D" : f[4] === "REP" ? "R" : null;
    if (!office || !side) continue;
    const key = office === "house" ? `${office}|${f[18]}|${Number(f[19])}` : `${office}|${f[18]}`;
    out.set(key, [...(out.get(key) ?? []), { last: fecLast(f[1]), side, ici: f[2], receipts: Number(f[5]) || 0 }]);
  }
  return out;
}

/** The FEC entry for a nominee: same seat, party and last name. */
const fecFor = (summary, office, state, district, side, name) => (summary.get(office === "house" ? `${office}|${state}|${district}` : `${office}|${state}`) ?? []).find((c) => c.side === side && c.last === lastName(name)) ?? null;

export function fundraising(d, r) {
  if (!d || !r || d.receipts <= 0 || r.receipts <= 0) return 0;
  return Math.max(-FUND_CAP, Math.min(FUND_CAP, Math.log(Math.max(d.receipts, 5000) / Math.max(r.receipts, 5000))));
}

// ---------- Regression ----------

function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((row) => row.slice(n));
}
const ALL_TERMS = ["intercept", "lean", "environment", "incumbent", "fundraising"];
/** The model's terms: with fundraising, or without it (races FEC doesn't cover, and governors). */
let TERMS = ALL_TERMS;
const x = (row) => [1, row.lean, row.environment, row.incumbent, row.fundraising].slice(0, TERMS.length);

function ols(rows) {
  const X = rows.map(x);
  const k = TERMS.length;
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert(xtx);
  const xty = Array.from({ length: k }, (_, i) => X.reduce((s, r, n) => s + r[i] * rows[n].margin, 0));
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  const resid = rows.map((r, n) => r.margin - X[n].reduce((s, v, j) => s + v * beta[j], 0));
  const s2 = resid.reduce((s, e) => s + e * e, 0) / (rows.length - k);
  const se = inv.map((row, i) => Math.sqrt(s2 * row[i]));
  return { beta, se, rmse: Math.sqrt(s2) };
}
const predict = (beta, row) => x(row).reduce((s, v, j) => s + v * beta[j], 0);
const r2 = (v) => Math.round(v * 100) / 100;

/** Leave-one-cycle-out: each cycle predicted from a fit on the others. `residuals` keeps every held-out miss. */
function backtest(rows) {
  const out = {};
  const residuals = [];
  let sq = 0;
  let n = 0;
  for (const year of CYCLES) {
    const train = rows.filter((r) => r.year !== year);
    const test = rows.filter((r) => r.year === year);
    if (!test.length || train.length < 20) continue;
    const { beta } = ols(train);
    const errors = test.map((r) => r.margin - predict(beta, r));
    test.forEach((r, i) => residuals.push({ year, state: r.state, lean: r.lean, e: errors[i] }));
    const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
    const wrong = test.filter((r) => Math.sign(predict(beta, r)) !== Math.sign(r.margin)).length;
    out[year] = { races: test.length, rmse: r2(rmse), mae: r2(errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length), bias: r2(errors.reduce((s, e) => s + e, 0) / errors.length), wrongWinner: wrong };
    sq += errors.reduce((s, e) => s + e * e, 0);
    n += errors.length;
  }
  return { cycles: out, rmse: r2(Math.sqrt(sq / n)), residuals };
}

// ---------- Correlated errors ----------

const DIVISION = JSON.parse(readFileSync(new URL("../lib/midterms/divisions.json", import.meta.url), "utf8"));
/** Lean buckets (points, relative to the nation): a stand-in for demographics, which move together in a wave. */
export const LEAN_EDGES = [-25, -12, -4, 4, 12, 25];
const bucketOf = (lean) => LEAN_EDGES.filter((edge) => lean >= edge).length;

/**
 * The standard deviation of an error shared by every race in a group within a cycle, from held-out residuals: the
 * spread of the groups' mean residuals beyond what their sizes alone would produce (method of moments). Each cycle's
 * own mean, the national miss, is taken out first.
 */
function sharedError(residuals, groupOf) {
  const byCycle = new Map();
  for (const r of residuals) byCycle.set(r.year, [...(byCycle.get(r.year) ?? []), r]);
  const groups = new Map();
  for (const [year, list] of byCycle) {
    const mean = list.reduce((s, r) => s + r.e, 0) / list.length;
    for (const r of list) {
      const key = `${year}|${groupOf(r)}`;
      groups.set(key, [...(groups.get(key) ?? []), r.e - mean]);
    }
  }
  const sized = [...groups.values()].filter((g) => g.length >= 3);
  const means = sized.map((g) => g.reduce((s, e) => s + e, 0) / g.length);
  const within = sized.map((g, i) => g.reduce((s, e) => s + (e - means[i]) ** 2, 0) / (g.length - 1));
  const grand = means.reduce((s, m) => s + m, 0) / means.length;
  const between = means.reduce((s, m) => s + (m - grand) ** 2, 0) / (means.length - 1);
  const noise = sized.reduce((s, g, i) => s + within[i] / g.length, 0) / sized.length;
  return { sd: r2(Math.sqrt(Math.max(0, between - noise))), groups: sized.length };
}

// ---------- Build ----------

const [houseRows, senateRows, presRows] = await Promise.all([
  dataverse(MEDSL.house).then((r) => r.text()).then(table),
  dataverse(MEDSL.senate).then((r) => r.text()).then(table),
  dataverse(MEDSL.president).then((r) => r.text()).then(table),
]);
const pres = presidential(presRows);
const national = nationalHouse(houseRows);

const districtPres = {};
for (const [cycle, id, gid, [di, ri]] of DISTRICT_PRES) {
  const map = (districtPres[cycle] = {});
  for (const line of (await (await get(SHEET(id, gid))).text()).split(/\r?\n/)) {
    const f = csvFields(line);
    const m = f[0]?.match(/^([A-Z]{2})-(\d{2}|AL)$/);
    const d = Number(f[di]);
    const r = Number(f[ri]);
    if (m && Number.isFinite(d) && Number.isFinite(r) && f[di] !== "") map[`${m[1]}|${m[2] === "AL" ? 0 : Number(m[2])}`] = d - r;
  }
}

const fecByCycle = {};
for (const c of [...CYCLES, 2026]) fecByCycle[c] = await fec(c);

function features(office, list) {
  const rows = [];
  for (const c of list) {
    const prior = PRIOR_PRES[c.year];
    const raw = office === "house" ? districtPres[c.year]?.[`${c.state}|${c.district === 0 ? 0 : c.district}`] : pres.state[prior]?.[c.state];
    if (raw === undefined) continue;
    const summary = fecByCycle[c.year];
    const d = fecFor(summary, office, c.state, c.district, "D", c.dName);
    const r = fecFor(summary, office, c.state, c.district, "R", c.rName);
    rows.push({
      ...c,
      lean: raw - pres.nation[prior],
      environment: national[c.year],
      incumbent: d?.ici === "I" ? 1 : r?.ici === "I" ? -1 : 0,
      fundraising: fundraising(d, r),
      matched: !!(d && r),
    });
  }
  return rows;
}

const result = { fitted: new Date().toISOString().slice(0, 10), national: { house: Object.fromEntries(CYCLES.map((y) => [y, r2(national[y])])), president: Object.fromEntries([2016, 2020, 2024].map((y) => [y, r2(pres.nation[y])])) } };
for (const [office, rows] of [["house", houseRows], ["senate", senateRows]]) {
  const data = features(office, contests(rows, office));
  for (const withFund of [true, false]) {
    TERMS = withFund ? ALL_TERMS : ALL_TERMS.slice(0, 4);
    const fit = ols(data);
    const bt = backtest(data);
    const name = withFund ? office : `${office}NoFundraising`;
    // Correlated errors come from the House's held-out misses: enough races in every region and lean bucket.
    if (office === "house" && withFund) {
      const region = sharedError(bt.residuals, (r) => DIVISION[r.state]);
      const bucket = sharedError(bt.residuals, (r) => bucketOf(r.lean));
      result.correlation = { region: region.sd, bucket: bucket.sd, regionGroups: region.groups, bucketGroups: bucket.groups, leanEdges: LEAN_EDGES };
      console.log("correlation", JSON.stringify(result.correlation));
    }
    result[name] = {
      coefficients: Object.fromEntries(TERMS.map((t, i) => [t, r2(fit.beta[i])])),
      standardErrors: Object.fromEntries(TERMS.map((t, i) => [t, r2(fit.se[i])])),
      inSampleRmse: r2(fit.rmse),
      sigma: bt.rmse,
      backtest: bt.cycles,
      races: data.length,
      fundraisingMatched: data.filter((r) => r.matched).length,
    };
    console.log(name, JSON.stringify({ c: result[name].coefficients, se: result[name].standardErrors, sigma: bt.rmse, bt: Object.fromEntries(Object.entries(bt.cycles).map(([y, b]) => [y, `${b.rmse} rmse, bias ${b.bias}, ${b.wrongWinner}/${b.races} wrong`])) }));
  }
}
writeFileSync(new URL("../lib/midterms/fit.json", import.meta.url), `${JSON.stringify(result)}\n`);
console.log("national", JSON.stringify(result.national));

// ---------- 2026 receipts per race ----------

const races = (await (await get(RACES_URL)).json()).races.filter((r) => r.office === "house" || r.office === "senate");
const receipts = {};
for (const race of races) {
  const key = `${race.office}:${race.state}:${race.office === "house" ? (race.district ?? 0) : ""}`;
  const entry = {};
  for (const c of race.candidates) {
    const side = sideOf(c.party);
    if (!side) continue;
    const hit = fecFor(fecByCycle[2026], race.office, race.state, race.district ?? 0, side, c.name);
    if (hit) entry[side] = Math.max(entry[side] ?? 0, hit.receipts);
  }
  if (entry.D && entry.R) receipts[key] = entry;
}
writeFileSync(new URL("../lib/midterms/fec2026.json", import.meta.url), `${JSON.stringify(receipts)}\n`);
console.log("2026 races with both sides' receipts:", Object.keys(receipts).length, "of", races.length);
