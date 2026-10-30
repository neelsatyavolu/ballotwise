// Polling averages the way Decision Desk HQ describes its own (votes-docs.decisiondeskhq.com/polling-methodology):
// every poll that discloses its field dates and sample size counts, adjusted for nothing but recency and whether it's a
// campaign internal. Few polls get a flat recency-weighted average; as polls accumulate the estimate blends toward a
// cubic-spline time trend, and from 15 polls on it is the trend alone. An average needs at least 2 polls.
// Polls come from VoteHub's free API (CC BY 4.0).
import type { Matchup, Side } from "./forecast";

export type VoteHubPoll = {
  id?: string;
  subject?: string;
  seat_name?: string | null;
  pollster?: string;
  start_date?: string | null;
  end_date?: string | null;
  sample_size?: number | null;
  population?: string | null;
  internal?: boolean;
  partisan?: string | null;
  sponsors?: string[] | null;
  url?: string | null;
  answers?: { choice: string; pct: number }[];
};

/** One poll as the race page lists it. `excluded` says why it doesn't count toward the average. */
export type PollRow = {
  pollster: string;
  start: string;
  end: string;
  n: number | null;
  pop: string | null;
  answers: { name: string; side: Side | null; pct: number }[];
  /** The left side (Democrat, or the independent facing the Republican) minus the Republican. */
  margin: number | null;
  internal: boolean;
  partisan: "D" | "R" | null;
  url: string | null;
  excluded: string | null;
};
/** [unix seconds, left side's share, Republican's share] for one day. */
export type TrendPoint = [number, number, number];
export type Average = { margin: number; left: number; right: number; count: number; latest: string };
export type RacePolls = { left: "D" | "I"; leftName: string; rightName: string; average: Average | null; trend: TrendPoint[]; rows: PollRow[] };

const DAY = 86_400_000;
/** A poll's weight halves every this many days in the flat average: older polls keep real influence when they're scarce. */
const HALF_LIFE_DAYS = 60;
/** The spline starts blending in at this many polls and takes over fully at SPLINE_FULL. */
const SPLINE_START = 5;
const SPLINE_FULL = 15;
/**
 * The trend is trusted only as far as recent polls support it: its weight scales with the polls in the last
 * RECENT_DAYS, reaching full at RECENT_FULL. Otherwise a spline fit to months of polls extrapolates its last slope
 * from two or three late ones.
 */
export const RECENT_DAYS = 30;
export const RECENT_FULL = 5;
/** Polls further back than this aren't listed or averaged. */
const WINDOW_DAYS = 365;
/** The trend line covers at most this many days. */
const TREND_DAYS = 240;
const POPULATION_RANK: Record<string, number> = { lv: 0, rv: 1, a: 2 };

export const lastName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/"[^"]*"|“[^”]*”/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
    .trim()
    .split(/\s+/)
    .at(-1) ?? "";

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * A campaign internal: VoteHub's flag, or a sponsor that is plainly a candidate's own committee ("Golden for Congress",
 * "Friends of Jane Smith"). Its key groups a campaign's internals so only the first counts as a new poll.
 */
export function internalKey(p: VoteHubPoll, names: readonly string[]): string | null {
  const sponsors = (p.sponsors ?? []).filter(Boolean);
  const own = sponsors.find((s) => /\bfor (congress|senate|governor)\b|\bcampaign\b|\bfriends of\b|committee to elect/i.test(s) || names.some((n) => n.length >= 4 && lastName(s).includes(n)));
  if (own) return own.toLowerCase();
  return p.internal ? (sponsors[0] ?? p.pollster ?? "internal").toLowerCase() : null;
}

const firstName = (name: string) => name.toLowerCase().replace(/["“][^"”]*["”]/g, " ").replace(/[^a-z\s]/g, " ").trim().split(/\s+/)[0] ?? "";

/** A nominee's answer: by last name, or by full name when two answers share it (Aaron and Danielle Ford). */
function answerFor(answers: readonly { choice: string; pct: number }[], name: string) {
  const hits = answers.filter((a) => lastName(a.choice) === lastName(name));
  return hits.length <= 1 ? (hits[0] ?? null) : (hits.find((a) => firstName(a.choice) === firstName(name)) ?? null);
}

/** Shares for the two sides when the poll asks about both nominees; null for a hypothetical or partial matchup. */
function shares(p: VoteHubPoll, m: Extract<Matchup, { kind: "contest" }>): { left: number; right: number } | null {
  const left = answerFor(p.answers ?? [], m.leftName);
  const right = answerFor(p.answers ?? [], m.rightName);
  return left && right ? { left: left.pct, right: right.pct } : null;
}

/**
 * In a race with both a Democrat and an independent against the Republican, whether the independent polls ahead of
 * the Democrat on average, across the window's polls that ask about both.
 */
export function independentLeads(polls: readonly VoteHubPoll[], democrat: string, independent: string, now: number): boolean {
  let lead = 0;
  for (const p of polls) {
    const end = p.end_date ? Date.parse(p.end_date) : NaN;
    if (!Number.isFinite(end) || end > now || now - end > WINDOW_DAYS * DAY) continue;
    const d = answerFor(p.answers ?? [], democrat);
    const i = answerFor(p.answers ?? [], independent);
    if (d && i) lead += i.pct - d.pct;
  }
  return lead > 0;
}

// ---------- Averaging ----------

type Point = { t: number; left: number; right: number };

/** Solves a small linear system by Gaussian elimination with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** A restricted (natural) cubic spline basis with four knots: linear beyond the outer knots, so it can't swing at the ends. */
function basis(t: number, k: readonly number[]): number[] {
  const cube = (x: number) => (x > 0 ? x * x * x : 0);
  const [k1, , k3, k4] = k;
  const scale = (k4 - k1) ** 2;
  const h = (kj: number) => (cube(t - kj) - (cube(t - k3) * (k4 - kj)) / (k4 - k3) + (cube(t - k4) * (k3 - kj)) / (k4 - k3)) / scale;
  return [1, t, h(k[0]), h(k[1])];
}

/** The spline's value at `at` for each side, or null when the polls are too bunched in time to fit one. */
function spline(points: readonly Point[], at: number): { left: number; right: number } | null {
  const ts = points.map((p) => p.t).sort((a, b) => a - b);
  const q = (f: number) => ts[Math.min(ts.length - 1, Math.round(f * (ts.length - 1)))];
  const knots = [q(0.05), q(0.35), q(0.65), q(0.95)];
  if (knots[3] - knots[0] < 14 || new Set(knots).size < 4) return null;
  const rows = points.map((p) => basis(p.t, knots));
  const fit = (ys: number[]) => {
    // Normal equations with a light ridge on the curvature terms, for stability with few polls.
    const xtx = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0) + (i === j && i >= 2 ? 1e-3 * rows.length : 0)));
    const xty = [0, 1, 2, 3].map((i) => rows.reduce((s, r, n) => s + r[i] * ys[n], 0));
    return solve(xtx, xty);
  };
  const bl = fit(points.map((p) => p.left));
  const br = fit(points.map((p) => p.right));
  if (!bl || !br) return null;
  // Evaluated no later than the newest poll: the trend isn't extended past the data.
  const x = basis(Math.min(at, ts[ts.length - 1]), knots);
  const dot = (b: number[]) => b.reduce((s, c, i) => s + c * x[i], 0);
  return { left: dot(bl), right: dot(br) };
}

/** The average as of day `at` (days since epoch) from the polls that had finished by then; null under 2 polls. */
export function averageAt(points: readonly Point[], at: number): { left: number; right: number; count: number } | null {
  const known = points.filter((p) => p.t <= at);
  if (known.length < 2) return null;
  let w = 0;
  let left = 0;
  let right = 0;
  for (const p of known) {
    const weight = 0.5 ** ((at - p.t) / HALF_LIFE_DAYS);
    w += weight;
    left += weight * p.left;
    right += weight * p.right;
  }
  const flat = { left: left / w, right: right / w };
  const recent = known.filter((p) => at - p.t <= RECENT_DAYS).length;
  const s = Math.min(1, Math.max(0, (known.length - SPLINE_START) / (SPLINE_FULL - SPLINE_START))) * Math.min(1, recent / RECENT_FULL);
  const trend = s > 0 ? spline(known, at) : null;
  const blend = (a: number, b: number | undefined) => (trend ? (1 - s) * a + s * (b ?? a) : a);
  return { left: blend(flat.left, trend?.left), right: blend(flat.right, trend?.right), count: known.length };
}

// ---------- One race ----------

/**
 * A race's polls, its current average and its trend. Polls missing field dates or a sample size are listed but not
 * counted; versions of one poll (likely and registered voters) collapse to one, preferring likely voters; a campaign's
 * later internals are averaged into its first instead of counting as new polls.
 */
export function racePolls(polls: readonly VoteHubPoll[], m: Extract<Matchup, { kind: "contest" }>, now: number): RacePolls {
  const names = [lastName(m.leftName), lastName(m.rightName)];
  const today = Math.floor(now / DAY);
  // One entry per poll (pollster and field dates), keeping the version that asks about both nominees, likely voters first.
  const versions = new Map<string, { p: VoteHubPoll; s: { left: number; right: number } | null }>();
  for (const p of polls) {
    const end = p.end_date ? Date.parse(p.end_date) : NaN;
    if (Number.isFinite(end) && (end > now || now - end > WINDOW_DAYS * DAY)) continue;
    const key = `${p.pollster}|${p.start_date}|${p.end_date}`;
    const s = shares(p, m);
    const prev = versions.get(key);
    const rank = (v: { p: VoteHubPoll; s: unknown }) => (v.s ? 0 : 10) + (POPULATION_RANK[v.p.population ?? ""] ?? 3);
    if (!prev || rank({ p, s }) < rank(prev)) versions.set(key, { p, s });
  }

  const rows: PollRow[] = [];
  const points: Point[] = [];
  const firstInternal = new Map<string, { point: Point; group: Point[] }>();
  const ordered = [...versions.values()].sort((a, b) => (a.p.end_date ?? "").localeCompare(b.p.end_date ?? ""));
  for (const { p, s } of ordered) {
    const internal = internalKey(p, names);
    let excluded: string | null = null;
    if (!p.start_date || !p.end_date) excluded = "No field dates disclosed";
    else if (!p.sample_size) excluded = "No sample size disclosed";
    else if (!s) excluded = "Doesn't ask about both nominees";
    if (!excluded && s) {
      const point = { t: Math.floor(Date.parse(p.end_date!) / DAY), left: s.left, right: s.right };
      const first = internal ? firstInternal.get(internal) : undefined;
      if (first) {
        // Averaged into the campaign's first internal rather than counted again.
        first.group.push(point);
        first.point.left = first.group.reduce((t, g) => t + g.left, 0) / first.group.length;
        first.point.right = first.group.reduce((t, g) => t + g.right, 0) / first.group.length;
        excluded = "Later internal from the same campaign, averaged into its first";
      } else {
        const own = { ...point };
        points.push(own);
        if (internal) firstInternal.set(internal, { point: own, group: [point] });
      }
    }
    const leftAnswer = answerFor(p.answers ?? [], m.leftName);
    const rightAnswer = answerFor(p.answers ?? [], m.rightName);
    const side = (a: { choice: string; pct: number }): Side | null => (a === leftAnswer ? m.left : a === rightAnswer ? "R" : null);
    rows.push({
      pollster: p.pollster ?? "Unknown pollster",
      start: p.start_date ?? "",
      end: p.end_date ?? "",
      n: p.sample_size ?? null,
      pop: p.population ?? null,
      answers: (p.answers ?? []).map((a) => ({ name: a.choice, side: side(a), pct: a.pct })),
      margin: s ? round1(s.left - s.right) : null,
      internal: internal !== null,
      partisan: p.partisan === "DEM" ? "D" : p.partisan === "REP" ? "R" : null,
      url: p.url ?? null,
      excluded,
    });
  }

  const now0 = averageAt(points, today);
  const trend: TrendPoint[] = [];
  if (points.length >= 2) {
    const start = Math.max(Math.min(...points.map((p) => p.t)), today - TREND_DAYS);
    for (let d = start; d <= today; d++) {
      const a = averageAt(points, d);
      if (a) trend.push([d * 86_400 + 43_200, round1(a.left), round1(a.right)]);
    }
  }
  const latest = ordered.filter((v) => v.s && v.p.end_date).at(-1)?.p.end_date ?? "";
  return {
    left: m.left,
    leftName: m.leftName,
    rightName: m.rightName,
    average: now0 ? { margin: round1(now0.left - now0.right), left: round1(now0.left), right: round1(now0.right), count: now0.count, latest } : null,
    trend,
    rows: rows.reverse(),
  };
}

/** The generic congressional ballot average (Democrats minus Republicans) from VoteHub's generic-ballot polls. */
/** How many days back a feed's polls count as fresh when judging whether it is complete enough to stand alone. */
export const FRESH_DAYS = 14;

export function genericBallot(polls: readonly VoteHubPoll[], now: number): { margin: number; count: number; recent: number; trend: TrendPoint[] } | null {
  const result = racePolls(
    // No campaign runs on the generic ballot, so sponsors (a party committee, say) don't make a poll an internal.
    polls.map((p) => ({ ...p, sponsors: null, internal: false, answers: (p.answers ?? []).map((a) => ({ ...a, choice: /^dem/i.test(a.choice) ? "Democrats" : /^rep/i.test(a.choice) ? "Republicans" : a.choice })) })),
    { kind: "contest", left: "D", leftName: "Democrats", rightName: "Republicans" },
    now,
  );
  const recent = result.rows.filter((r) => !r.excluded && r.end && now - Date.parse(`${r.end}T12:00:00Z`) <= FRESH_DAYS * DAY).length;
  return result.average ? { margin: result.average.margin, count: result.average.count, recent, trend: result.trend } : null;
}
