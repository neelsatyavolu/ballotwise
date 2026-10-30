// Ballotwise's race forecast, built the way Decision Desk HQ describes its own (votes-docs.decisiondeskhq.com/forecast-methodology):
// a fundamentals margin from the seat's partisan lean, the national environment, incumbency, the incumbent's own past
// vote and fundraising, blended with the polling average, turned into a win probability, then blended with prediction
// market prices. Global settings on top of the fit are tuned to agree with DDHQ's published forecast (tuning.json).
// The fundamentals are a regression fit on the 2018-2024 House and Senate races (scripts/fit-forecast.mjs, which
// writes fit.json); DDHQ fits an ensemble on the same kind of data. Pure functions: odds.ts runs them on its
// scheduled refresh.
import fitJson from "./fit.json";
import tuningJson from "./tuning.json";
import { HOLDOVER, type Office, type RaceSummary, type Rating } from "./races";

export type Side = "D" | "R" | "I";
type Odds = Partial<Record<Side, number>>;

type Terms = { intercept: number; lean: number; environment: number; incumbent: number; personal: number; fundraising?: number };
type Reliability = { band: string; races: number; predicted: number; actual: number };
type Calibration = { k: number; midtermSigma: number | null; presidentialSigma: number; midtermLogScoreGain: number; kCompetitiveOnly: number; before: { logScore: number; brier: number; reliability: Reliability[] }; after: { logScore: number; brier: number; reliability: Reliability[] }; tuned: { k: number; logScore: number; brier: number; reliability: Reliability[] } | null; seatCheck?: { backtest: SeatCheck; tuned: SeatCheck; grid?: { share: number; national: number | null; logLik: number }[] } };
type SeatCheck = { share: number | null; national: number | null; logLik: number; cycles: Record<string, { races: number; actual: number; expected: number; sd: number; z: number }> };
type Model = {
  coefficients: Terms;
  standardErrors: Terms;
  /** Held-out root mean square miss, with the environment as known before each election. */
  sigma: number;
  /** The σ multiplier chosen by held-out log score, and midterm cycles' own σ when that scored better. */
  calibration: Calibration;
  /** Root mean square of the held-out cycles' average misses: the part of the error every race in a cycle shares. */
  cycleBias: number;
  backtest: Record<string, { races: number; rmse: number; mae: number; bias: number; wrongWinner: number }>;
  races: number;
};
export const FIT = fitJson as unknown as {
  fitted: string;
  /** Errors shared within a census division, and within a partisan-lean bucket, in a cycle (points), from the backtest. */
  correlation: { region: number; bucket: number; regionGroups: number; bucketGroups: number; leanEdges: number[] };
  national: { house: Record<string, number>; generic: Record<string, number>; president: Record<string, number> };
  house: Model;
  houseNoFundraising: Model;
  senate: Model;
  senateNoFundraising: Model;
};

export type Body = "house" | "senate" | "governor";

/**
 * Hyperparameters tuned so the forecast agrees with DDHQ's published one (scripts/tune-to-ddhq.mjs), on top of the
 * fitted model. Per office: the σ multiplier, the market blend's maximum weight, a scale on the fitted personal-vote
 * coefficient, and the share of each race's variance the chamber simulations draw from errors shared with other races.
 * Shared: the market clip and a scale on the fitted environment coefficient. The backtest's own choices are in
 * fit.json's `calibration`.
 */
export type Tuning = {
  k: Record<Body, number>;
  markets: { max: Record<Body, number>; clip: number };
  environment: number;
  personal: Record<Body, number>;
  shared: Record<Body, number>;
  /** How much of the final chance the expert raters' consensus takes, where there is one. */
  experts: Record<Body, number>;
  /** A scale on the fitted flat incumbency term. */
  incumbency: Record<Body, number>;
  /** The most an incumbent's measured personal vote can count for, in points either way, before its coefficient. */
  personalCap: Record<Body, number>;
  /** The largest fundraising ratio counted, as a natural log (3 is 20 to 1): past it, more money adds nothing. */
  fundraisingCap: Record<Body, number>;
  /** How many polls a race needs for its polling average to reach full weight. */
  pollFull: Record<Body, number>;
  /** The national draw's fraction of the shared variance, the rest split between region and lean band; null keeps the backtest's proportions. */
  nationalShare: Record<Body, number | null>;
};
export const TUNING: Tuning = tuningJson;

export const PARAMS = {
  /** Polls count up to `max` of the margin, reaching it at `full` polls (DDHQ: a well-polled race is "nearly half" polls). */
  polls: { max: 0.5, full: 10 },
  /** The chance an expert rating gives its favorite, by category (Safe and Solid alike). */
  experts: { solid: 0.97, likely: 0.85, lean: 0.68, tilt: 0.58, tossup: 0.5 },
  /**
   * Markets count up to `max` of the probability, from `min` traded to `full`, on a log scale; prices are kept within
   * `clip` of 0 and 1. A third at most: markets trailed poll-based models down the ballot in 2024, and no race-level
   * price history could be backtested here, so they stay the minority input. Clipped at 10–90% because fees, capital
   * tied up until November and the favorite-longshot bias hold heavy favorites at 95–99¢ whatever their real odds.
   */
  markets: { min: 10_000, full: 1_000_000, clip: TUNING.markets.clip },
  /** Harris minus Trump nationally in 2024: the leans are measured against it. */
  national2024: FIT.national.president["2024"],
} as const;

/** The fitted model for an office: governors borrow the Senate's statewide fit without fundraising (MEDSL has no governor returns). */
export function modelFor(office: Office, withFundraising: boolean): Model {
  if (office === "house") return withFundraising ? FIT.house : FIT.houseNoFundraising;
  return withFundraising && office === "senate" ? FIT.senate : FIT.senateNoFundraising;
}

/**
 * A race's uncertainty in points: the held-out miss with the environment as known before the election (so the
 * generic ballot's own polling error is already in it), midterm cycles' own when that scored better (2026 is a
 * midterm), times the office's multiplier.
 */
export const sigmaOf = (m: Model, office: Body, t: Tuning = TUNING) => t.k[office] * (m.calibration.midtermSigma ?? m.sigma);

/** The national part of that uncertainty in the backtest, in points, moving every race together: how far whole cycles ran from the model. */
export const nationalError = (m: Model) => m.cycleBias;
/** The lean bucket (relative to the nation) a seat falls in: races in one bucket share part of their error, like a demographic wave. */
export const leanBucket = (relativeLean: number) => FIT.correlation.leanEdges.filter((edge) => relativeLean >= edge).length;

/** The share of a race's variance its national, regional and lean-band errors take in the backtest. */
export function backtestShare(m: Model, office: Body, grouped = true, t: Tuning = TUNING): number {
  const sigma = sigmaOf(m, office, t);
  const shared = nationalError(m) ** 2 + (grouped ? FIT.correlation.region ** 2 + FIT.correlation.bucket ** 2 : 0);
  return Math.min(0.75, shared / sigma ** 2);
}

/**
 * How a race's error splits into a national part, a part shared with its census division, a part shared with its lean
 * bucket, and its own, as weights on standard normal draws that add up to its whole uncertainty. The three shared
 * parts keep the backtest's proportions and together take the office's tuned share of the variance (never less than
 * the backtest's own), so a race's total uncertainty, and its chance, stay the same.
 */
function errorParts(m: Model, office: Body, grouped: boolean, t: Tuning) {
  const fitted = { national: nationalError(m) ** 2, region: grouped ? FIT.correlation.region ** 2 : 0, bucket: grouped ? FIT.correlation.bucket ** 2 : 0 };
  const local = fitted.region + fitted.bucket;
  const fraction = t.nationalShare[office];
  const parts =
    fraction === null || !grouped || local === 0
      ? fitted
      : { national: fraction, region: ((1 - fraction) * fitted.region) / local, bucket: ((1 - fraction) * fitted.bucket) / local };
  const sum = parts.national + parts.region + parts.bucket;
  const share = Math.min(0.95, Math.max(backtestShare(m, office, grouped, t), t.shared[office]));
  const w = (v: number) => Math.sqrt((share * v) / sum);
  return { national: w(parts.national), region: w(parts.region), bucket: w(parts.bucket), own: Math.sqrt(1 - share) };
}

/** Who the forecast is between: a two-sided contest against the Republican, a seat with no real opposition, or neither. */
export type Matchup =
  | { kind: "contest"; left: "D" | "I"; leftName: string; rightName: string }
  | { kind: "uncontested"; side: Side; alone: boolean }
  /** Two candidates of one party, or a top-two race with no Republican: partisanship can't separate them. */
  | { kind: "open" };

const sideOf = (party: string): Side | null => (/^democrat/i.test(party) ? "D" : /^republican/i.test(party) ? "R" : /independent/i.test(party) ? "I" : null);
/** States whose general elections are top-two runoffs, where a race can lack a Republican without being one-sided. */
const TOP_TWO = new Set(["CA", "WA"]);

/**
 * `incumbent` names the seat's holder: when a party runs several candidates (Alaska's top four), the holder is that
 * party's nominee for the forecast, else the first listed.
 */
export function matchup(r: Pick<RaceSummary, "state" | "candidates">, incumbent?: string | null): Matchup {
  const surname = (n: string) => n.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, " ").trim().split(/\s+/).at(-1);
  const isHolder = (n: string) => !!incumbent && surname(n) === surname(incumbent);
  const by = (s: Side) => r.candidates.filter((c) => sideOf(c.party) === s).sort((a, b) => Number(isHolder(b.name)) - Number(isHolder(a.name)));
  const [d, rep, ind] = [by("D"), by("R"), by("I")];
  if (d.length && rep.length) return { kind: "contest", left: "D", leftName: d[0].name, rightName: rep[0].name };
  if (rep.length === 1 && ind.length) return { kind: "contest", left: "I", leftName: ind[0].name, rightName: rep[0].name };
  if (d.length > 1 || rep.length > 1 || ind.length > 1) return { kind: "open" };
  if (TOP_TWO.has(r.state) && r.candidates.length > 1) return { kind: "open" };
  const only = d[0] ?? rep[0];
  if (only) return { kind: "uncontested", side: sideOf(only.party)!, alone: r.candidates.length === 1 };
  return { kind: "open" };
}

export type Inputs = {
  office: Office;
  /** ln(Democrat's receipts / Republican's), capped at ±3; null when FEC lacks either side. */
  fundraising?: number | null;
  /** 2024 presidential margin, Harris minus Trump, in points; null when unknown. */
  lean: number | null;
  /** Generic ballot average, Democrats minus Republicans, in points; null when unknown. */
  genericBallot: number | null;
  /** The side whose incumbent is on the ballot, if any. */
  incumbent: Side | null;
  /** That incumbent's personal vote: how far they ran ahead of their seat last time, signed toward the Democrat. */
  personal?: number | null;
  /** Polling average as the left side minus the Republican. */
  polls: { margin: number; count: number } | null;
  market: { odds: Odds; volume?: number } | null;
  /** Expert raters' calls: each one's favored side (null for a toss-up) and the chance its category stands for. */
  experts?: { side: Side | null; p: number }[] | null;
};

export type Forecast = {
  /** Each side's chance of winning. */
  odds: Odds;
  /** The side opposing the Republican in a contest (D, or an independent), else the favorite. */
  left: Side;
  /** The two nominees the forecast is between, in a contest. */
  names: { left: string; right: string } | null;
  /** Expected margin (left minus Republican) before markets; null outside a two-sided contest. */
  margin: number | null;
  /** The seat's 2024 presidential margin (Harris minus Trump). */
  lean: number | null;
  /** Points added for an incumbent on the ballot, signed toward the left side. */
  incumbency: number;
  /** Points from the fundraising gap, signed toward the left side; null when it isn't part of the model. */
  fundraising?: number | null;
  /** Points from the incumbent's personal vote, signed toward the left side; null without one. */
  personal?: number | null;
  /** The forecast's uncertainty in points, for the chamber simulations. */
  sigma?: number;
  fundamentals: number | null;
  /** The national shift applied to the 2024 lean. */
  environment: number | null;
  pollWeight: number;
  pollMargin: number | null;
  marketWeight: number;
  /** The market's chance for the left side, after clipping; null without a usable market. */
  market: number | null;
  /** The expert raters' average chance for the left side, and its weight in the final chance; absent without ratings. */
  expert?: number | null;
  expertWeight?: number;
};

/** Standard normal CDF (Abramowitz and Stegun 26.2.17, accurate to 1e-7). */
export function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Inverse of `phi` (Acklam's rational approximation), for turning a chance back into a margin. */
export function phiInverse(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (x: number) => (((((c[0] * x + c[1]) * x + c[2]) * x + c[3]) * x + c[4]) * x + c[5]) / ((((d[0] * x + d[1]) * x + d[2]) * x + d[3]) * x + 1);
  if (q < 0.02425) return tail(Math.sqrt(-2 * Math.log(q)));
  if (q > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - q)));
  const r = q - 0.5;
  const s = r * r;
  return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

export const pollWeight = (count: number, full: number = PARAMS.polls.full) => (count >= 2 ? PARAMS.polls.max * Math.min(1, count / full) : 0);

export function marketWeight(volume: number | undefined, office: Body, t: Tuning = TUNING): number {
  const { min, full } = PARAMS.markets;
  if (!volume || volume < min) return 0;
  return t.markets.max[office] * Math.min(1, Math.log(volume / min) / Math.log(full / min));
}

/** The market's chance for `left` against the Republican, from whichever of the two it prices, clipped. */
function marketChance(odds: Odds, left: Side, t: Tuning): number | null {
  const l = odds[left];
  const r = odds.R;
  if (l === undefined && r === undefined) return null;
  const share = l !== undefined && r !== undefined ? l / Math.max(1e-9, l + r) : l !== undefined ? l : 1 - r!;
  return Math.min(1 - t.markets.clip, Math.max(t.markets.clip, share));
}

/** The forecast for one race, or null when nothing separates the candidates (an open race with no market). */
export function forecastRace(m: Matchup, x: Inputs, t: Tuning = TUNING): Forecast | null {
  const empty = { names: null, margin: null, lean: null, incumbency: 0, fundamentals: null, environment: null, pollWeight: 0, pollMargin: null, marketWeight: 0, market: null };
  if (m.kind === "open") {
    const priced = Object.entries(x.market?.odds ?? {}).filter(([, p]) => p > 0);
    if (priced.length < 2) return null;
    const [top] = priced.sort((a, b) => b[1] - a[1]);
    return { ...empty, odds: Object.fromEntries(priced), left: top[0] as Side, marketWeight: 1 };
  }
  if (m.kind === "uncontested") {
    // Minor-party opposition only: a market that gives the challenger real odds is believed; otherwise the seat is all but certain.
    const challenger = x.market ? 1 - (x.market.odds[m.side] ?? 1) : 0;
    if (!m.alone && challenger > 0.1) return { ...empty, odds: { ...x.market!.odds }, left: m.side, marketWeight: 1 };
    return { ...empty, odds: { [m.side]: m.alone ? 1 : 0.99 }, left: m.side };
  }
  const hasFund = x.fundraising !== undefined && x.fundraising !== null && m.left === "D";
  const model = modelFor(x.office, hasFund);
  const c = model.coefficients;
  const sigma = sigmaOf(model, x.office as Body, t);
  const environment = x.genericBallot === null ? 0 : t.environment * c.environment * x.genericBallot;
  const body = x.office as Body;
  const clamp = (v: number, cap: number) => Math.max(-cap, Math.min(cap, v));
  const incumbency = x.incumbent === null ? 0 : (x.incumbent === "R" ? -1 : x.incumbent === m.left ? 1 : 0) * c.incumbent * t.incumbency[body];
  const personal = x.incumbent !== null && x.personal ? t.personal[body] * c.personal * clamp(x.personal, t.personalCap[body]) : null;
  const fundraising = hasFund ? (c.fundraising ?? 0) * clamp(x.fundraising!, t.fundraisingCap[body]) : null;
  const fundamentals = x.lean === null ? null : c.intercept + c.lean * (x.lean - PARAMS.national2024) + environment + incumbency + (personal ?? 0) + (fundraising ?? 0);
  const wPoll = x.polls ? pollWeight(x.polls.count, t.pollFull[body]) : 0;
  // Without a lean the polls stand alone; without either there is nothing to model, and the market (if any) decides.
  const margin = fundamentals === null ? (x.polls && x.polls.count >= 2 ? x.polls.margin : null) : (1 - wPoll) * fundamentals + wPoll * (x.polls?.margin ?? 0);
  const base = margin === null ? null : phi(margin / sigma);
  const market = x.market ? marketChance(x.market.odds, m.left, t) : null;
  const wMarket = market === null ? 0 : base === null ? 1 : marketWeight(x.market?.volume, x.office as Body, t);
  const expert = x.experts?.length ? x.experts.reduce((sum, e) => sum + (e.side === null ? 0.5 : e.side === m.left ? e.p : 1 - e.p), 0) / x.experts.length : null;
  if (base === null && market === null && expert === null) return null;
  const blended = base === null && market === null ? expert! : base === null ? market! : (1 - wMarket) * base + wMarket * (market ?? base);
  const wExpert = expert === null ? 0 : base === null && market === null ? 1 : t.experts[x.office as Body];
  const p = (1 - wExpert) * blended + wExpert * (expert ?? blended);
  return {
    odds: { [m.left]: round3(p), R: round3(1 - p) },
    left: m.left,
    names: { left: m.leftName, right: m.rightName },
    margin: margin === null ? null : round1(margin),
    lean: x.lean,
    incumbency: round1(incumbency),
    fundraising: fundraising === null ? null : round1(fundraising),
    personal: personal === null ? null : round1(personal),
    sigma: round1(sigma),
    fundamentals: fundamentals === null ? null : round1(fundamentals),
    environment: round1(environment),
    pollWeight: round3(fundamentals === null && margin !== null ? 1 : wPoll),
    pollMargin: x.polls && x.polls.count >= 2 ? x.polls.margin : null,
    marketWeight: round3(wMarket),
    market: market === null ? null : round3(market),
    expert: expert === null ? null : round3(expert),
    expertWeight: round3(wExpert),
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The favorite and their chance. */
export function favorite(f: Pick<Forecast, "odds">): { side: Side; p: number } | null {
  const [top, second] = (Object.entries(f.odds) as [Side, number][]).sort((a, b) => b[1] - a[1]);
  if (!top || top[1] === second?.[1]) return null;
  return { side: top[0], p: top[1] };
}

/** DDHQ's rating scale: Safe at 95% or more (no rating), Likely at 75%, Lean above 60%, otherwise a toss-up. */
export function ratingOf(f: Pick<Forecast, "odds"> | null): Rating | null {
  if (!f) return null;
  const fav = favorite(f);
  if (!fav) return "tossup";
  if (fav.p >= 0.95) return null;
  if (fav.p >= 0.75) return `likely-${fav.side.toLowerCase()}` as Rating;
  if (fav.p > 0.6) return `lean-${fav.side.toLowerCase()}` as Rating;
  return "tossup";
}

// ---------- Chambers ----------

/** A seeded random number generator (mulberry32), so a refresh with the same inputs gives the same chamber odds. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (next: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next());

export type RatingCounts = { safeD: number; likelyD: number; leanD: number; tossup: number; leanR: number; likelyR: number; safeR: number; other: number };
export type ChamberView = {
  /** Chance Democrats control the chamber (for governors: hold a majority of the 50 governorships). */
  dControl: number;
  /** Simulated mean seats, including seats not up this year. */
  dSeats: number;
  rSeats: number;
  /** Races up this year by forecast rating. */
  ratings: RatingCounts;
  /** Democratic seat totals across the simulations. */
  distribution: { seats: number; p: number }[];
  notUp: { D: number; R: number; other: number };
  majority: number;
};
export type Chambers = { house: ChamberView; senate: ChamberView; governor: ChamberView };

/**
 * `majority` is what Democrats need for a majority of their own. `rKeeps`, where set, is what Republicans need to keep
 * control; Democrats' chance of control is the chance Republicans fall short of it, so a winning independent (Nebraska's
 * Osborn) counts against Republican control rather than for neither side, and the two parties' chances add to 100%.
 */
const BODIES: Record<Body, { notUp: { D: number; R: number; other: number }; majority: number; rKeeps?: number }> = {
  house: { notUp: { D: 0, R: 0, other: 0 }, majority: 218, rKeeps: 218 },
  // The vice president breaks a 50-50 Senate tie for Republicans: they keep control at 50, and Democrats need 51.
  senate: { notUp: HOLDOVER.senate, majority: 51, rKeeps: 50 },
  governor: { notUp: HOLDOVER.governor, majority: 26 },
};

/** A race's rating bucket from its forecast; "other" for an independent favorite or no forecast. */
function bucket(odds: Odds | null): keyof RatingCounts {
  if (!odds) return "other";
  const fav = favorite({ odds });
  if (!fav) return "tossup";
  if (fav.side === "I") return "other";
  const r = ratingOf({ odds });
  if (!r) return fav.side === "D" ? "safeD" : "safeR";
  if (r === "tossup") return "tossup";
  return `${r.startsWith("lean") ? "lean" : "likely"}${fav.side}` as keyof RatingCounts;
}

/**
 * Chamber control from simulated elections. Each race's chance becomes a margin in units of its own error; one
 * national miss per simulation (the generic ballot's polling error and the backtest's cycle-wide bias, as a share of
 * each race's uncertainty) moves every race in every chamber together, so seats aren't independent coin flips.
 * Democrats control the House and Senate when Republicans fall short of 218 and 50 (the vice president breaks a tie);
 * a governors' majority is 26 of 50. Independents who win count toward neither party's seats, but against Republican
 * control.
 */
export function chamberViews(races: readonly { office: Office; forecast: Pick<Forecast, "odds"> | null; region?: string; bucket?: number }[], runs = 10_000, t: Tuning = TUNING): Chambers {
  const next = rng(2026);
  const regionIds = new Map<string, number>();
  const rows = races
    .filter((r): r is { office: Body; forecast: Pick<Forecast, "odds"> | null; region?: string; bucket?: number } => r.office !== "measure")
    .map((r) => {
      const odds = r.forecast?.odds ?? null;
      const ranked = (Object.entries(odds ?? {}) as [Side, number][]).sort((a, b) => b[1] - a[1]);
      // The side facing the Republican (or the favorite when there's no Republican) and its chance.
      const left = (ranked.find(([s]) => s !== "R") ?? ranked[0])?.[0] ?? null;
      const p = left ? (odds![left] ?? 0) : 0;
      const loser: Side | null = left === null ? null : ranked.find(([s]) => s !== left)?.[0] ?? (left === "R" ? "D" : "R");
      const grouped = r.region !== undefined && r.bucket !== undefined;
      if (grouped && !regionIds.has(r.region!)) regionIds.set(r.region!, regionIds.size);
      return {
        office: r.office,
        left,
        loser,
        z: phiInverse(Math.min(1, Math.max(0, p))),
        certain: p >= 1 ? true : p <= 0 ? false : null,
        parts: errorParts(modelFor(r.office, r.office !== "governor"), r.office, grouped, t),
        region: grouped ? regionIds.get(r.region!)! : -1,
        leanBucket: grouped ? r.bucket! : -1,
        bucket: bucket(odds),
      };
    });
  const buckets = FIT.correlation.leanEdges.length + 1;
  const bodies = Object.keys(BODIES) as Body[];
  const seats = Object.fromEntries(bodies.map((b) => [b, { d: 0, r: 0, wins: 0, hist: new Map<number, number>() }])) as Record<Body, { d: number; r: number; wins: number; hist: Map<number, number> }>;
  for (let i = 0; i < runs; i++) {
    const national = gauss(next);
    // One draw per census division and per lean bucket, shared by every race in it across all three chambers.
    const regional = Array.from({ length: regionIds.size }, () => gauss(next));
    const waves = Array.from({ length: buckets }, () => gauss(next));
    const tally = Object.fromEntries(bodies.map((b) => [b, { D: BODIES[b].notUp.D, R: BODIES[b].notUp.R }])) as Record<Body, { D: number; R: number }>;
    for (const r of rows) {
      if (!r.left) continue;
      const shared = r.parts.national * national + (r.region >= 0 ? r.parts.region * regional[r.region] + r.parts.bucket * waves[r.leanBucket] : 0);
      const leftWins = r.certain ?? r.z + shared + r.parts.own * gauss(next) > 0;
      const winner = leftWins ? r.left : r.loser;
      if (winner === "D") tally[r.office].D += 1;
      else if (winner === "R") tally[r.office].R += 1;
    }
    for (const b of bodies) {
      const s = seats[b];
      s.d += tally[b].D;
      s.r += tally[b].R;
      const { majority, rKeeps } = BODIES[b];
      if (rKeeps === undefined ? tally[b].D >= majority : tally[b].R < rKeeps) s.wins += 1;
      s.hist.set(tally[b].D, (s.hist.get(tally[b].D) ?? 0) + 1);
    }
  }
  const view = (b: Body): ChamberView => {
    const ratings: RatingCounts = { safeD: 0, likelyD: 0, leanD: 0, tossup: 0, leanR: 0, likelyR: 0, safeR: 0, other: 0 };
    for (const r of rows) if (r.office === b) ratings[r.bucket] += 1;
    const s = seats[b];
    return {
      dControl: round3(s.wins / runs),
      dSeats: Math.round(s.d / runs),
      rSeats: Math.round(s.r / runs),
      ratings,
      distribution: [...s.hist].sort((x, y) => x[0] - y[0]).map(([n, c]) => ({ seats: n, p: Math.round((c / runs) * 10_000) / 10_000 })),
      notUp: { ...BODIES[b].notUp },
      majority: BODIES[b].majority,
    };
  };
  return { house: view("house"), senate: view("senate"), governor: view("governor") };
}
