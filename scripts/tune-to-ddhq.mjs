// Tunes the forecast's hyperparameters (lib/midterms/tuning.json) so its race chances, seats and chamber odds agree
// with Decision Desk HQ's published forecast. The fitted model (fit.json) stays as fit; only settings that apply to
// every race of an office move: its σ multiplier, its market weight, the expert raters' weight, scales on its lean,
// personal-vote and fundraising coefficients, an offset to its fundamentals, its polls' weight curve, and the share of
// each race's variance its chamber simulation draws from shared errors (which leaves race chances alone); and, for all
// offices, the market clip and a scale on the environment coefficient. No race is adjusted on its own.
//
// The benchmark is a JSON file read off DDHQ's public pages, kept outside the repo (their terms don't allow copying
// their content); only the resulting parameters are written:
//
//   { "captured": "when the pages were read",
//     "control": { "house": [lo, hi], "senate": [lo, hi] },
//     "seats": { "house": { "D": n, "R": n }, "senate": { "D": n, "R": n } },
//     "tossups": { "house": [race keys], "senate": [...], "governor": [...] },
//     "ratings": { "house": [Safe D, Likely D, Lean D, Toss-up, Lean R, Likely R, Safe R], ... },
//     "races": { "<race key>": { "side": "D" | "R" | null, "p": favorite's chance }, ... } }
//
// The objective, in order of weight: the exact toss-up set per office, each chamber's expected seats more than 0.4
// from the benchmark's and control outside the target range, each listed race more than 5 points from the
// benchmark's chance (and how far past); then ratings and the mean gap; ties go to settings whose matched ratings sit furthest from a rating line and
// whose k is nearest the backtest's. A grid over the shared settings, each office searched on its own within it, then
// a coordinate search at finer steps until nothing improves. The report ends with the match itself, pass or fail.
//
// Run with `node scripts/tune-to-ddhq.mjs <benchmark.json> [--refresh] [--dry-run] [--evaluate] [--office=senate]`;
// --evaluate reports on the settings in tuning.json without searching, and --office searches only that office's own
// settings, leaving the other offices and the shared settings as they are. The House and Senate keep DDHQ's own
// published weights (METHOD) and search only the rest. Inputs (prod races and market
// prices, VoteHub and Wikipedia polls, the aggregators' generic ballot) are cached beside the benchmark; --refresh fetches them again.
// It bundles the app's own forecast code with esbuild (installed with wrangler), so the search runs the real model.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [benchPath, ...flags] = process.argv.slice(2);
if (!benchPath) throw new Error("usage: node scripts/tune-to-ddhq.mjs <benchmark.json> [--refresh] [--dry-run] [--evaluate] [--office=senate]");
const bench = JSON.parse(readFileSync(benchPath, "utf8"));
const WORK = dirname(resolve(benchPath));
const RACES_URL = process.env.RACES_URL ?? "https://ballotwise.xanom.co/api/midterms";
const VOTEHUB = "https://api.votehub.com/polls";
const HEADERS = { accept: "application/json", "user-agent": "Ballotwise/1.0 (+https://ballotwise.xanom.co/midterms)" };
const OFFICES = ["house", "senate", "governor"];
const ONLY = flags.find((f) => f.startsWith("--office="))?.slice("--office=".length) ?? null;
if (ONLY && !OFFICES.includes(ONLY)) throw new Error(`--office must be one of ${OFFICES.join(", ")}`);
/** The offices whose settings are searched. */
const SEARCHED = ONLY ? [ONLY] : OFFICES;
const BUCKETS = ["safeD", "likelyD", "leanD", "tossup", "leanR", "likelyR", "safeR"];
/** A listed race more than FAR from the benchmark's chance is a miss the search works hardest to avoid; past OFF, a lesser one. */
const FAR = 0.1;
const OFF = 0.05;

// ---------- The app's forecast code ----------

const bundle = join(WORK, "forecast-bundle.mjs");
await build({
  stdin: { contents: 'export * from "./lib/midterms/odds"; export * from "./lib/midterms/forecast"; export * from "./lib/midterms/pollAverage"; export * from "./lib/midterms/genericAggregates"; export * from "./lib/midterms/wikiPolls";', resolveDir: ROOT, loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  logLevel: "error",
});
const M = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);

// ---------- Inputs ----------

const cachePath = join(WORK, "tune-inputs.json");
async function fetchInputs() {
  const json = async (url) => {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.json();
  };
  const races = (await json(RACES_URL)).races.filter((r) => r.office !== "measure");
  const now = Date.now();
  const polls = {};
  for (const [office, type] of [["senate", "us-senator"], ["governor", "governor"], ["house", "us-representative"]]) {
    const wiki = office === "house" ? [] : await M.fetchWikiPolls(office, races, HEADERS);
    for (const [key, p] of M.officePolls(M.mergePolls(await json(`${VOTEHUB}?poll_type=${type}`), wiki), office, races, now)) {
      if (p.average) polls[key] = { margin: p.average.margin, count: p.average.count, latest: p.average.latest, left: p.left };
    }
  }
  const own = M.genericBallot(await json(`${VOTEHUB}?poll_type=generic-ballot`), now);
  const aggregate = M.aggregateMedian(await M.fetchAggregates(HEADERS), now);
  return { fetched: new Date(now).toISOString(), generic: M.genericMargin(own, aggregate), races: races.map((r) => ({ ...r, trend: undefined })), polls };
}
const inputs = !flags.includes("--refresh") && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : await fetchInputs();
writeFileSync(cachePath, JSON.stringify(inputs));
const key = (r) => M.raceKey(r.office, r.state, r.district);

// ---------- Scoring ----------

const favoriteOf = (f) => (f ? M.favorite(f) : null);
/**
 * Our chance for the benchmark's favorite (an independent facing the Republican stands in for a Democrat), read off the
 * odds so a dead heat counts as 50%; for a benchmark toss-up with no side, our favorite's chance. Null without a forecast.
 */
const chanceFor = (f, want) => {
  if (!f) return null;
  if (want.side === null) return favoriteOf(f)?.p ?? 0.5;
  return f.odds[want.side] ?? (want.side === "D" ? f.odds.I : undefined) ?? 0;
};
const officeOf = (k) => k.split(":")[0];
const isTossup = (f) => M.ratingOf(f) === "tossup";
const RACES = Object.fromEntries(OFFICES.map((o) => [o, inputs.races.filter((r) => r.office === o)]));
// Each race's matchup and inputs, computed once; only the tuned settings change between evaluations.
const PREPARED = Object.fromEntries(OFFICES.map((o) => [o, RACES[o].map((r) => ({ key: key(r), ...M.raceInputs(r, r.signal?.market ?? null, inputs.polls[key(r)] ?? null, inputs.generic) }))]));
const forecastsOf = (t, office) => new Map(PREPARED[office].map((p) => [p.key, M.forecastRace(p.matchup, p.inputs, t)]));
const chamberOf = (t, office, forecasts, runs) => M.chamberViews(M.chamberEntries(RACES[office], (r) => forecasts.get(key(r))), runs, t)[office];
const ratingAt = (side, p) => M.ratingOf({ odds: { [side]: p, [side === "D" ? "R" : "D"]: 1 - p } });
/** The backtest's own σ multiplier per office; the search prefers settings near it. */
/** Each chamber's seats not up this year, from the simulation's own table. */
const NOT_UP = Object.fromEntries(OFFICES.map((o) => [o, M.chamberViews([], 1)[o].notUp]));
const BACKTEST_K = { house: M.FIT.house.calibration.k, senate: M.FIT.senate.calibration.k, governor: M.FIT.senateNoFundraising.calibration.k };
/** Distance from the nearest rating line (60, 75, 95), for how well a matched rating would hold up as data moves. */
const edgeDistance = (p) => Math.min(...[0.6, 0.75, 0.95].map((line) => Math.abs(p - line)));

/**
 * One office's distance from the benchmark, weighted in order: each race on the wrong side of the toss-up line (plus
 * how far past it, so the search can see progress), then control outside its range (points), then each listed race
 * with a different rating, then the rating counts, then the mean gap in chances; and as tie-breaks, how close the
 * matched races sit to a rating line and how far k strays from the backtest's. Without `chamber`, control is left out.
 */
function officeScore(office, forecasts, chamber, t) {
  const theirs = new Set(bench.tossups[office] ?? []);
  let tossMiss = 0;
  let tossSoft = 0;
  let edge = 0.1;
  let tossEdge = 0.1;
  for (const [k, f] of forecasts) {
    const fav = favoriteOf(f)?.p ?? 0.5;
    if (theirs.has(k) && !isTossup(f)) {
      tossMiss += 1;
      tossSoft += fav - 0.6;
    } else if (!theirs.has(k) && isTossup(f)) {
      tossMiss += 1;
      tossSoft += 0.6 - fav + 0.005;
    } else if (theirs.has(k)) tossEdge = Math.min(tossEdge, 0.6 - fav);
  }
  const [lo, hi] = bench.control?.[office] ?? [0, 1];
  const controlMiss = chamber ? Math.max(0, lo - chamber.dControl, chamber.dControl - hi) * 100 : 0;
  let ratingMiss = 0;
  let gap = 0;
  let listed = 0;
  let far = 0;
  let off = 0;
  // A race's gap counts toward the mean, and once past FAR or OFF also as a race that isn't close.
  let excess = 0;
  const miss = (d) => {
    gap += d;
    far += d > FAR ? 1 : 0;
    off += d > OFF ? 1 : 0;
    // Past 4.5 points, so races sitting just inside OFF are pulled further in.
    excess += Math.max(0, d - (OFF - 0.005));
  };
  for (const [k, want] of Object.entries(bench.races ?? {})) {
    if (officeOf(k) !== office) continue;
    const ours = chanceFor(forecasts.get(k), want);
    if (ours === null) continue;
    listed += 1;
    miss(Math.abs(ours - want.p));
    if (want.side === null) continue;
    const fav = favoriteOf(forecasts.get(k));
    if (fav?.side !== want.side || M.ratingOf(forecasts.get(k)) !== ratingAt(want.side, want.p)) ratingMiss += 1;
    else edge = Math.min(edge, edgeDistance(ours));
  }
  let countsMiss = 0;
  const counts = bench.ratings?.[office];
  if (counts) {
    const ours = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    for (const f of forecasts.values()) {
      const fav = favoriteOf(f);
      if (!fav || fav.side === "I") continue;
      const r = M.ratingOf(f);
      ours[!r ? `safe${fav.side}` : r === "tossup" ? "tossup" : `${r.startsWith("lean") ? "lean" : "likely"}${fav.side}`] += 1;
    }
    BUCKETS.forEach((b, i) => (countsMiss += Math.abs(ours[b] - counts[i])));
  }
  // Seats are the expected count, the sum of each side's chances plus the seats not up: a miss once it's more than
  // 0.4 from the benchmark's whole number, so it rounds the same way with room for the simulation's noise.
  const want = bench.seats?.[office];
  const expectedD = NOT_UP[office].D + [...forecasts.values()].reduce((s, f) => s + (f?.odds?.D ?? 0) + (f?.odds?.I ?? 0), 0);
  const seatMiss = want ? Math.max(0, Math.abs(expectedD - want.D) - 0.4) : 0;
  // Matched toss-ups closer than 2 points to the 60 line would flip as data refreshes: 10 a point short of that.
  const edgeMiss = 100 * Math.max(0, 0.02 - tossEdge);
  const tieBreak = 20 * (0.1 - Math.max(0, Math.min(edge, tossEdge))) + 3 * Math.abs(t.k[office] - BACKTEST_K[office]);
  // The match itself comes first: the toss-up set, each chamber's seats and control, then each race past OFF (and how
  // far past); other ratings only break ties.
  const total = 100 * tossMiss + 100 * tossSoft + 200 * seatMiss + 50 * controlMiss + 30 * off + 300 * excess + edgeMiss + ratingMiss + 0.2 * countsMiss + (5 * 100 * gap) / Math.max(1, listed) + tieBreak;
  return { total, tossMiss, controlMiss, seatMiss, ratingMiss, countsMiss, far, off, gap: (100 * gap) / Math.max(1, listed), listed, edge: tossEdge };
}

function score(t, runs = 2000) {
  const parts = SEARCHED.map((o) => {
    const f = forecastsOf(t, o);
    return officeScore(o, f, chamberOf(t, o, f, runs), t);
  });
  const sum = (k) => parts.reduce((s, p) => s + p[k], 0);
  const listed = sum("listed");
  return { total: sum("total"), tossMiss: sum("tossMiss"), controlMiss: sum("controlMiss"), seatMiss: sum("seatMiss"), ratingMiss: sum("ratingMiss"), countsMiss: sum("countsMiss"), far: sum("far"), off: sum("off"), gap: parts.reduce((s, p) => s + p.gap * p.listed, 0) / Math.max(1, listed) };
}

// ---------- Search ----------

const range = (lo, hi, step) => Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Math.round((lo + i * step) * 1000) / 1000);
const withOffice = (t, office, { k, max, personal, shared, experts, incumbency, personalCap, fundraisingCap, pollFull, nationalShare, pollMax, lean, fundraising, offset }) => ({
  ...t,
  k: { ...t.k, [office]: k ?? t.k[office] },
  markets: { ...t.markets, max: { ...t.markets.max, [office]: max ?? t.markets.max[office] } },
  personal: { ...t.personal, [office]: personal ?? t.personal[office] },
  shared: { ...t.shared, [office]: shared ?? t.shared[office] },
  experts: { ...t.experts, [office]: experts ?? t.experts[office] },
  incumbency: { ...t.incumbency, [office]: incumbency ?? t.incumbency[office] },
  personalCap: { ...t.personalCap, [office]: personalCap ?? t.personalCap[office] },
  fundraisingCap: { ...t.fundraisingCap, [office]: fundraisingCap ?? t.fundraisingCap[office] },
  pollFull: { ...t.pollFull, [office]: pollFull ?? t.pollFull[office] },
  pollMax: { ...t.pollMax, [office]: pollMax ?? t.pollMax[office] },
  lean: { ...t.lean, [office]: lean ?? t.lean[office] },
  fundraising: { ...t.fundraising, [office]: fundraising ?? t.fundraising[office] },
  offset: { ...t.offset, [office]: offset ?? t.offset[office] },
  nationalShare: { ...t.nationalShare, [office]: nationalShare === undefined ? t.nationalShare[office] : nationalShare },
});
const K = range(0.6, 2, 0.1);
const MAX = range(0, 0.5, 0.1);
const PERSONAL = range(0, 2, 0.5);
const EXPERTS = range(0, 0.6, 0.1);
const SHARE = range(0, 0.9, 0.05);
/**
 * DDHQ's published method (votes-docs.decisiondeskhq.com/forecast-methodology), held fixed rather than searched: no
 * expert ratings, markets at 25% of the chance, and one national factor behind every race's shared error. Congress keeps
 * incumbency and the personal vote, which DDHQ's method doesn't list: our fit was made with them, dropping them after
 * the fit moves incumbents' seats away from DDHQ's, and without Susan Collins's DDHQ's Maine toss-up reads Lean D. Governors add candidate quality (the personal vote) to
 * the margin in full, as DDHQ's governor fundamentals are a plain sum of baseline, incumbency and quality, and search
 * the rest.
 */
const METHOD = { house: { experts: 0, max: 0.25, nationalShare: 1 }, senate: { experts: 0, max: 0.25, nationalShare: 1 }, governor: { personal: 1 / M.FIT.senateNoFundraising.coefficients.personal } };
/** A setting's search values: the method's own where it fixes one. */
const grid = (office, key, values) => (METHOD[office]?.[key] === undefined ? values : [METHOD[office][key]]);
/** Settings shared by every office, searched as a full grid. */
const SHARED = { clip: [0.03, 0.06, 0.1], environment: range(0.85, 1.25, 0.05) };

/**
 * For fixed shared settings, one office's best k, market weight and personal-vote scale on the ratings, then its
 * shared-error share on control. Offices are independent once the shared settings are fixed.
 */
function bestForOffice(t, office) {
  const statics = [];
  for (const k of K) for (const max of grid(office, "max", MAX)) for (const personal of grid(office, "personal", PERSONAL)) for (const experts of grid(office, "experts", EXPERTS)) {
    const tk = withOffice(t, office, { k, max, personal, experts });
    const forecasts = forecastsOf(tk, office);
    statics.push({ tk, forecasts, s: officeScore(office, forecasts, null, tk).total });
  }
  statics.sort((a, b) => a.s - b.s);
  let best = null;
  for (const c of statics.slice(0, 5)) {
    for (const shared of bench.control?.[office] ? SHARE : [0]) {
      const ts = withOffice(c.tk, office, { shared });
      const s = officeScore(office, c.forecasts, chamberOf(ts, office, c.forecasts, 1500), ts);
      if (!best || s.total < best.s.total) best = { t: ts, s };
    }
  }
  return best;
}

const EVALUATE = flags.includes("--evaluate");
// A search starts from the method's fixed settings; --evaluate reports on tuning.json as it is.
const start = EVALUATE ? M.TUNING : Object.keys(METHOD).reduce((t, o) => withOffice(t, o, METHOD[o]), M.TUNING);
let best = start;
let bestTotal = Infinity;
let tried = 0;
if (ONLY && !EVALUATE) best = bestForOffice(start, ONLY).t;
for (const clip of EVALUATE || ONLY ? [] : SHARED.clip) {
  for (const environment of SHARED.environment) {
    let t = { ...start, markets: { ...start.markets, clip }, environment };
    let total = 0;
    for (const office of OFFICES) {
      const b = bestForOffice(t, office);
      t = withOffice(t, office, { k: b.t.k[office], max: b.t.markets.max[office], personal: b.t.personal[office], shared: b.t.shared[office], experts: b.t.experts[office] });
      total += b.s.total;
    }
    tried += 1;
    if (total < bestTotal) {
      bestTotal = total;
      best = t;
    }
    console.log(`grid ${tried}`, total.toFixed(2), "best", bestTotal.toFixed(2), JSON.stringify(t));
  }
}

/** Coordinate descent on every parameter at finer steps, with the full objective, until a pass changes nothing. */
const FINE = [
  ...SEARCHED.flatMap((o) => [
    [(t, v) => withOffice(t, o, { k: v }), range(0.5, 2.2, 0.02)],
    [(t, v) => withOffice(t, o, { max: v }), grid(o, "max", range(0, 0.5, 0.025))],
    [(t, v) => withOffice(t, o, { personal: v }), grid(o, "personal", range(0, 2, 0.05))],
    [(t, v) => withOffice(t, o, { shared: v }), range(0, 0.9, 0.025)],
    [(t, v) => withOffice(t, o, { experts: v }), grid(o, "experts", range(0, 0.8, 0.025))],
    [(t, v) => withOffice(t, o, { incumbency: v }), grid(o, "incumbency", range(0, 2, 0.1))],
    [(t, v) => withOffice(t, o, { personalCap: v }), grid(o, "personalCap", range(2, 25, 0.5))],
    [(t, v) => withOffice(t, o, { fundraisingCap: v }), range(0.5, 3, 0.25)],
    [(t, v) => withOffice(t, o, { pollFull: v }), [2, 3, 4, 5, 6, 8, 10, 15]],
    [(t, v) => withOffice(t, o, { nationalShare: v }), grid(o, "nationalShare", [null, 0, 0.25, 0.5, 0.75, 1])],
    [(t, v) => withOffice(t, o, { offset: v }), range(-8, 8, 0.25)],
    [(t, v) => withOffice(t, o, { lean: v }), range(0.5, 1.5, 0.02)],
    [(t, v) => withOffice(t, o, { fundraising: v }), range(-1, 3, 0.1)],
    [(t, v) => withOffice(t, o, { pollMax: v }), range(0, 0.8, 0.05)],
  ]),
  ...(ONLY
    ? []
    : [
        [(t, v) => ({ ...t, markets: { ...t.markets, clip: v } }), range(0.03, 0.15, 0.01)],
        [(t, v) => ({ ...t, environment: v }), range(0.8, 1.3, 0.025)],
      ]),
];
let bestScore = score(best);
for (let pass = 1; pass <= (EVALUATE ? 0 : 4); pass++) {
  const before = bestScore.total;
  for (const [set, grid] of FINE) {
    for (const v of grid) {
      const candidate = set(best, v);
      const s = score(candidate);
      if (s.total < bestScore.total - 1e-9) {
        best = candidate;
        bestScore = s;
      }
    }
  }
  console.log(`polish ${pass}`, bestScore.total.toFixed(2), JSON.stringify(best));
  if (bestScore.total >= before - 1e-9) break;
}

// ---------- Report ----------

const finalForecasts = new Map(OFFICES.flatMap((o) => [...forecastsOf(best, o)]));
const final = { forecasts: finalForecasts, chambers: M.chamberViews(M.chamberEntries(inputs.races, (r) => finalForecasts.get(key(r))), 10_000, best) };
const check = score(best, 10_000);
console.log("\ntuned", JSON.stringify(best), JSON.stringify(check));
console.log("generic ballot input", inputs.generic, "inputs fetched", inputs.fetched);
const pct = (p) => (100 * p).toFixed(1);
for (const office of OFFICES) {
  const ours = [...final.forecasts].filter(([k, f]) => officeOf(k) === office && isTossup(f)).map(([k]) => k);
  const theirs = bench.tossups[office] ?? [];
  console.log(`\n${office} toss-ups — ours ${ours.length}: ${ours.join(" ")}\n  theirs ${theirs.length}: ${theirs.join(" ")}`);
  const describe = (k) => {
    const f = final.forecasts.get(k);
    const fav = favoriteOf(f);
    return `${k} ${fav ? `${fav.side} ${pct(fav.p)}` : "—"} margin ${f?.margin} (fundamentals ${f?.fundamentals}, polls ${f?.pollMargin ?? "—"} at ${f?.pollWeight}, personal ${f?.personal ?? "—"}) experts ${f?.expert === null || f?.expert === undefined ? "—" : pct(f.expert)} at ${f?.expertWeight} market ${f?.market === null || f?.market === undefined ? "—" : pct(f.market)} at ${f?.marketWeight}`;
  };
  console.log("  matched toss-ups, points below the 60 line:", theirs.filter((k) => ours.includes(k)).map((k) => `${k.split(":").slice(1).join("-").replace(/-$/, "")} ${(100 * (0.6 - (favoriteOf(final.forecasts.get(k))?.p ?? 0.5))).toFixed(1)}`).join(", "));
  console.log(`  shared-error share ${best.shared[office]} (backtest's own ${M.backtestShare(M.modelFor(office, office !== "governor"), office, true, best).toFixed(3)})`);
  for (const k of theirs.filter((k) => !ours.includes(k))) console.log("  missing:", describe(k));
  for (const k of ours.filter((k) => !theirs.includes(k))) console.log("  extra:  ", describe(k));
  const v = final.chambers[office];
  let c = 0;
  let lo = null;
  let hi = null;
  for (const b of v.distribution) {
    c += b.p;
    if (lo === null && c >= 0.1) lo = b.seats;
    if (hi === null && c >= 0.9) hi = b.seats;
  }
  console.log(`  control ${pct(v.dControl)}% D, ${v.dSeats}–${v.rSeats} (10th–90th ${lo}–${hi}); ratings ${BUCKETS.map((b) => v.ratings[b]).join("/")} vs ${(bench.ratings?.[office] ?? []).join("/")}`);
}
console.log("\nlisted races");
let same = 0;
for (const [k, want] of Object.entries(bench.races ?? {})) {
  const f = final.forecasts.get(k);
  const fav = favoriteOf(f);
  const theirs = want.side === null ? "tossup" : M.ratingOf({ odds: { [want.side]: want.p, [want.side === "D" ? "R" : "D"]: 1 - want.p } }) ?? "safe";
  const ours = M.ratingOf(f) ?? "safe";
  const match = (want.side === null || fav?.side === want.side) && ours === theirs;
  same += match ? 1 : 0;
  console.log(`  ${k.padEnd(14)} ours ${fav ? `${fav.side} ${pct(fav.p)}` : "—"} ${ours.padEnd(9)} theirs ${want.side ?? "?"} ${pct(want.p)} ${theirs.padEnd(9)} ${match ? "" : "≠"}`);
}
console.log(`  same rating ${same} of ${Object.keys(bench.races ?? {}).length}, mean gap ${check.gap.toFixed(1)}`);

// The match against the benchmark, pass or fail: each chamber's seats exactly, control within the range, and every
// listed race's chance for the benchmark's favorite within OFF of theirs.
console.log(`\nmatch against the benchmark${bench.captured ? ` captured ${bench.captured}` : ""}`);
const fails = [];
for (const office of ["house", "senate"]) {
  const v = final.chambers[office];
  const want = bench.seats?.[office];
  if (want) {
    const ok = v.dSeats === want.D && v.rSeats === want.R;
    if (!ok) fails.push(`${office} seats`);
    const expected = v.notUp.D + [...final.forecasts].filter(([k]) => officeOf(k) === office).reduce((s, [, f]) => s + (f?.odds?.D ?? 0) + (f?.odds?.I ?? 0), 0);
    console.log(`  ${office} seats    ours ${v.dSeats}–${v.rSeats} (D's chances sum to ${expected.toFixed(2)}) theirs ${want.D}–${want.R} ${ok ? "ok" : "FAIL"}`);
  }
  const [lo, hi] = bench.control?.[office] ?? [0, 1];
  const ok = v.dControl >= lo - 1e-9 && v.dControl <= hi + 1e-9;
  if (!ok) fails.push(`${office} control`);
  console.log(`  ${office} control  ours D ${pct(v.dControl)} R ${pct(1 - v.dControl)} theirs D ${pct((lo + hi) / 2)} R ${pct(1 - (lo + hi) / 2)} ${ok ? "ok" : "FAIL"}`);
}
for (const office of OFFICES) {
  const gaps = Object.entries(bench.races ?? {})
    .filter(([k]) => officeOf(k) === office)
    .map(([k, want]) => {
      const ours = chanceFor(final.forecasts.get(k), want);
      return { k, want, ours, gap: ours === null ? Infinity : Math.abs(ours - want.p) };
    })
    .sort((a, b) => b.gap - a.gap);
  const over = gaps.filter((g) => g.gap > OFF + 1e-9);
  if (over.length) fails.push(`${over.length} ${office} races`);
  console.log(`  ${office} races    ${gaps.length - over.length} of ${gaps.length} within ${100 * OFF} points ${over.length ? "FAIL" : "ok"}; largest gaps:`);
  for (const g of gaps.slice(0, 10)) console.log(`    ${g.k.padEnd(14)} ours ${g.ours === null ? "—" : pct(g.ours)} theirs ${pct(g.want.p)} for ${g.want.side ?? "?"}, gap ${(100 * g.gap).toFixed(1)}`);
}
console.log(fails.length ? `  FAIL: ${fails.join(", ")}` : "  PASS");

if (!flags.includes("--dry-run") && !EVALUATE) {
  const round = (v) => Math.round(v * 1000) / 1000;
  const per = (rec) => Object.fromEntries(OFFICES.map((o) => [o, round(rec[o])]));
  const out = { k: per(best.k), markets: { max: per(best.markets.max), clip: round(best.markets.clip) }, environment: round(best.environment), personal: per(best.personal), shared: per(best.shared), experts: per(best.experts), incumbency: per(best.incumbency), personalCap: per(best.personalCap), fundraisingCap: per(best.fundraisingCap), nationalShare: Object.fromEntries(OFFICES.map((o) => [o, best.nationalShare[o] === null ? null : round(best.nationalShare[o])])), pollFull: per(best.pollFull), pollMax: per(best.pollMax), lean: per(best.lean), fundraising: per(best.fundraising), offset: per(best.offset) };
  writeFileSync(join(ROOT, "lib/midterms/tuning.json"), `${JSON.stringify(out)}\n`);
  console.log("\nwrote lib/midterms/tuning.json");
}
