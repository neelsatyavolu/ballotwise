// Tunes the forecast's hyperparameters (lib/midterms/tuning.json) so its ratings and chamber odds agree with Decision
// Desk HQ's published forecast. The fitted model (fit.json) stays as fit; only settings that apply to every race of an
// office move: its σ multiplier, its market weight, the expert raters' weight, a scale on its personal-vote coefficient
// and the share of each race's variance its chamber simulation draws from shared errors (which leaves race chances
// alone); and, for all offices, the market clip and a scale on the environment coefficient. No race is adjusted on
// its own.
//
// The benchmark is a JSON file read off DDHQ's public pages, kept outside the repo (their terms don't allow copying
// their content); only the resulting parameters are written:
//
//   { "control": { "house": [lo, hi], "senate": [lo, hi] },
//     "tossups": { "house": [race keys], "senate": [...], "governor": [...] },
//     "ratings": { "house": [Safe D, Likely D, Lean D, Toss-up, Lean R, Likely R, Safe R], ... },
//     "races": { "<race key>": { "side": "D" | "R" | null, "p": favorite's chance }, ... } }
//
// The objective, in order of weight: the exact toss-up set per office, chamber control within the target range, each
// listed race more than 10 points from the benchmark's chance, then the rating of each listed race and the mean gap in
// their chances (a point of mean gap weighs as much as a race with the wrong rating), each race more than 5 points off,
// then the rating counts; ties go to settings whose matched ratings sit furthest from a rating line
// and whose k is nearest the backtest's. A grid over the shared settings, each office searched on its own within it,
// then a coordinate search at finer steps until nothing improves.
//
// Run with `node scripts/tune-to-ddhq.mjs <benchmark.json> [--refresh] [--dry-run] [--evaluate] [--office=senate]`;
// --evaluate reports on the settings in tuning.json without searching, and --office searches only that office's own
// settings, leaving the other offices and the shared settings as they are. Inputs (prod races and market
// prices, VoteHub polls, the aggregators' generic ballot) are cached beside the benchmark; --refresh fetches them again.
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
  stdin: { contents: 'export * from "./lib/midterms/odds"; export * from "./lib/midterms/forecast"; export * from "./lib/midterms/pollAverage"; export * from "./lib/midterms/genericAggregates";', resolveDir: ROOT, loader: "ts" },
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
    for (const [key, p] of M.officePolls(await json(`${VOTEHUB}?poll_type=${type}`), office, races, now)) {
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
const officeOf = (k) => k.split(":")[0];
const isTossup = (f) => M.ratingOf(f) === "tossup";
const RACES = Object.fromEntries(OFFICES.map((o) => [o, inputs.races.filter((r) => r.office === o)]));
// Each race's matchup and inputs, computed once; only the tuned settings change between evaluations.
const PREPARED = Object.fromEntries(OFFICES.map((o) => [o, RACES[o].map((r) => ({ key: key(r), ...M.raceInputs(r, r.signal?.market ?? null, inputs.polls[key(r)] ?? null, inputs.generic) }))]));
const forecastsOf = (t, office) => new Map(PREPARED[office].map((p) => [p.key, M.forecastRace(p.matchup, p.inputs, t)]));
const chamberOf = (t, office, forecasts, runs) => M.chamberViews(M.chamberEntries(RACES[office], (r) => forecasts.get(key(r))), runs, t)[office];
const ratingAt = (side, p) => M.ratingOf({ odds: { [side]: p, [side === "D" ? "R" : "D"]: 1 - p } });
/** The backtest's own σ multiplier per office; the search prefers settings near it. */
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
  const miss = (d) => {
    gap += d;
    far += d > FAR ? 1 : 0;
    off += d > OFF ? 1 : 0;
  };
  for (const [k, want] of Object.entries(bench.races ?? {})) {
    if (officeOf(k) !== office) continue;
    const fav = favoriteOf(forecasts.get(k));
    if (!fav) continue;
    listed += 1;
    if (want.side === null) {
      miss(Math.abs(fav.p - want.p));
      continue;
    }
    miss(Math.abs((fav.side === want.side ? fav.p : 1 - fav.p) - want.p));
    if (fav.side !== want.side || M.ratingOf(forecasts.get(k)) !== ratingAt(want.side, want.p)) ratingMiss += 1;
    else edge = Math.min(edge, edgeDistance(fav.p));
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
  // Matched toss-ups closer than 2 points to the 60 line would flip as data refreshes: 10 a point short of that.
  const edgeMiss = 1000 * Math.max(0, 0.02 - tossEdge);
  const tieBreak = 20 * (0.1 - Math.max(0, Math.min(edge, tossEdge))) + 3 * Math.abs(t.k[office] - BACKTEST_K[office]);
  const total = 100 * tossMiss + 100 * tossSoft + 20 * controlMiss + edgeMiss + 50 * far + 5 * ratingMiss + 2 * off + countsMiss + (5 * 100 * gap) / Math.max(1, listed) + tieBreak;
  return { total, tossMiss, controlMiss, ratingMiss, countsMiss, far, off, gap: (100 * gap) / Math.max(1, listed), listed, edge: tossEdge };
}

function score(t, runs = 2000) {
  const parts = SEARCHED.map((o) => {
    const f = forecastsOf(t, o);
    return officeScore(o, f, chamberOf(t, o, f, runs), t);
  });
  const sum = (k) => parts.reduce((s, p) => s + p[k], 0);
  const listed = sum("listed");
  return { total: sum("total"), tossMiss: sum("tossMiss"), controlMiss: sum("controlMiss"), ratingMiss: sum("ratingMiss"), countsMiss: sum("countsMiss"), far: sum("far"), off: sum("off"), gap: parts.reduce((s, p) => s + p.gap * p.listed, 0) / Math.max(1, listed) };
}

// ---------- Search ----------

const range = (lo, hi, step) => Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Math.round((lo + i * step) * 1000) / 1000);
const withOffice = (t, office, { k, max, personal, shared, experts, incumbency, personalCap, fundraisingCap, pollFull, nationalShare }) => ({
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
  nationalShare: { ...t.nationalShare, [office]: nationalShare === undefined ? t.nationalShare[office] : nationalShare },
});
const K = range(0.6, 2, 0.1);
const MAX = range(0, 0.5, 0.1);
const PERSONAL = range(0, 2, 0.5);
const EXPERTS = range(0, 0.6, 0.1);
const SHARE = range(0, 0.9, 0.05);
/** Settings shared by every office, searched as a full grid. */
const SHARED = { clip: [0.03, 0.06, 0.1], environment: range(0.85, 1.25, 0.05) };

/**
 * For fixed shared settings, one office's best k, market weight and personal-vote scale on the ratings, then its
 * shared-error share on control. Offices are independent once the shared settings are fixed.
 */
function bestForOffice(t, office) {
  const statics = [];
  for (const k of K) for (const max of MAX) for (const personal of PERSONAL) for (const experts of EXPERTS) {
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

const start = M.TUNING;
const EVALUATE = flags.includes("--evaluate");
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
    [(t, v) => withOffice(t, o, { max: v }), range(0, 0.5, 0.025)],
    [(t, v) => withOffice(t, o, { personal: v }), range(0, 2, 0.05)],
    [(t, v) => withOffice(t, o, { shared: v }), range(0, 0.9, 0.025)],
    [(t, v) => withOffice(t, o, { experts: v }), range(0, 0.8, 0.025)],
    [(t, v) => withOffice(t, o, { incumbency: v }), range(0, 2, 0.1)],
    [(t, v) => withOffice(t, o, { personalCap: v }), range(2, 25, 0.5)],
    [(t, v) => withOffice(t, o, { fundraisingCap: v }), range(0.5, 3, 0.25)],
    [(t, v) => withOffice(t, o, { pollFull: v }), [2, 3, 4, 5, 6, 8, 10, 15]],
    [(t, v) => withOffice(t, o, { nationalShare: v }), [null, 0, 0.25, 0.5, 0.75, 1]],
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
  console.log("  matched toss-ups, points below the 60 line:", theirs.filter((k) => ours.includes(k)).map((k) => `${k.split(":").slice(1).join("-").replace(/-$/, "")} ${(100 * (0.6 - favoriteOf(final.forecasts.get(k)).p)).toFixed(1)}`).join(", "));
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

if (!flags.includes("--dry-run") && !EVALUATE) {
  const round = (v) => Math.round(v * 1000) / 1000;
  const per = (rec) => Object.fromEntries(OFFICES.map((o) => [o, round(rec[o])]));
  const out = { k: per(best.k), markets: { max: per(best.markets.max), clip: round(best.markets.clip) }, environment: round(best.environment), personal: per(best.personal), shared: per(best.shared), experts: per(best.experts), incumbency: per(best.incumbency), personalCap: per(best.personalCap), fundraisingCap: per(best.fundraisingCap), nationalShare: Object.fromEntries(OFFICES.map((o) => [o, best.nationalShare[o] === null ? null : round(best.nationalShare[o])])), pollFull: per(best.pollFull) };
  writeFileSync(join(ROOT, "lib/midterms/tuning.json"), `${JSON.stringify(out)}\n`);
  console.log("\nwrote lib/midterms/tuning.json");
}
