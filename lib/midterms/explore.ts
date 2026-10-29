// Filtering and sorting for the election-night results explorer. Every choice round-trips through the URL.
import { leadingFlip, outcomeOf } from "./holders";
import { closeWaves, stateFinal } from "./polls";
import { colorOf, compareRaces, lead, partyOf, raceLabel, ratingFill, shade, STATE_NAMES, type Office, type RaceSummary } from "./view";

export type Status = "awaiting" | "counting" | "called";
/** How competitive a race is: a rating tier, "safe" when markets or polls exist but no rating applies, "unrated" with no evidence at all. */
export type Tier = "tossup" | "lean" | "likely" | "safe" | "unrated";
export type Leader = "D" | "R" | "other" | "yes" | "no";
/** Quick views: one tap each, on top of any other filters. */
export type View = "all" | "key" | "uncalled" | "close" | "gains" | "mine";
export type Sort = "close" | "competitive" | "called" | "reporting" | "closing" | "state";

export type Filters = {
  office: Office | "all";
  view: View;
  q: string;
  states: string[];
  status: Status[];
  tiers: Tier[];
  leaders: Leader[];
  /** Largest lead shown, in points; null for any. */
  maxMargin: number | null;
  /** Smallest share reporting shown; null for any. */
  minReporting: number | null;
  /** Poll-closing times (ms): shows races in states whose last polls close then. */
  waves: number[];
  sort: Sort;
};

export const DEFAULT_FILTERS: Filters = { office: "senate", view: "all", q: "", states: [], status: [], tiers: [], leaders: [], maxMargin: null, minReporting: null, waves: [], sort: "close" };

/** A lead under this many points with votes counted makes a race "close". */
export const CLOSE_MARGIN = 5;
/** Under this share reporting, a count is early: its lead says little, so it sorts after fuller counts and stays pale on maps. */
export const EARLY_REPORTING = 25;

export const isEarly = (r: RaceSummary) => r.total > 0 && !r.candidates.some((c) => c.winner) && !r.reportingUnknown && r.reporting < EARLY_REPORTING;

export const isCalled = (r: RaceSummary) => r.candidates.some((c) => c.winner);

export function statusOf(r: RaceSummary): Status {
  if (isCalled(r)) return "called";
  return r.total > 0 ? "counting" : "awaiting";
}

export function tierOf(r: RaceSummary): Tier {
  if (r.rating) return r.rating === "tossup" ? "tossup" : r.rating.startsWith("lean") ? "lean" : "likely";
  return r.signal && (r.signal.market || r.signal.polls) ? "safe" : "unrated";
}

/**
 * The side the pre-election evidence favors: the market favorite, else the polling leader, else the rating's side.
 * Never the party holding the seat; null when there's no evidence or it's even.
 */
export function favoredSide(r: RaceSummary): "D" | "R" | "I" | null {
  const odds = Object.entries(r.signal?.market?.odds ?? {}).sort((a, b) => b[1] - a[1]);
  if (odds.length && odds[0][1] !== odds[1]?.[1]) return odds[0][0] as "D" | "R" | "I";
  const m = r.signal?.polls?.margin;
  if (m) return m > 0 ? "D" : "R";
  if (r.rating && r.rating !== "tossup") return r.rating.endsWith("-d") ? "D" : r.rating.endsWith("-r") ? "R" : "I";
  return null;
}

/** The favorite in a race the evidence calls safe (markets or polls, but no rating); null otherwise. */
export function safeSide(r: RaceSummary): "D" | "R" | "I" | null {
  return tierOf(r) === "safe" ? favoredSide(r) : null;
}

const SIDE_COLOR = { D: "var(--dem)", R: "var(--rep)", I: "var(--oth)" } as const;

/**
 * A race's map fill: the leader once votes are in, else the projection. A race the evidence calls safe gets its
 * favorite's full color; one with no market or polls stays blank.
 */
export function raceFill(r: RaceSummary): string {
  const ahead = lead(r.candidates);
  if (ahead) return shade(colorOf(ahead.leader), ahead.margin, r.reporting);
  if (r.rating) return ratingFill(r.rating);
  const safe = safeSide(r);
  return safe ? shade(SIDE_COLOR[safe], 20) : ratingFill(null);
}

/** Who is ahead, or has won: a party, or Yes/No on a measure; null before votes and on a tie. */
export function leaderOf(r: RaceSummary): Leader | null {
  const ahead = lead(r.candidates);
  const leader = r.candidates.find((c) => c.winner) ?? (ahead && ahead.margin > 0 ? ahead.leader : null);
  if (!leader) return null;
  return /^yes$/i.test(leader.name) ? "yes" : /^no$/i.test(leader.name) ? "no" : partyOf(leader.party);
}

/** An incumbent on the ballot who lost a called race. */
export function ousted(r: RaceSummary): boolean {
  const won = r.candidates.find((c) => c.winner);
  return !!won && !won.incumbent && r.candidates.some((c) => c.incumbent);
}

const marginOf = (r: RaceSummary) => lead(r.candidates)?.margin ?? null;

function inView(r: RaceSummary, view: View, mine: readonly number[] | null): boolean {
  switch (view) {
    case "key":
      return ["tossup", "lean", "likely"].includes(tierOf(r));
    case "uncalled":
      return !isCalled(r);
    case "close": {
      const m = marginOf(r);
      return !isCalled(r) && m !== null && m < CLOSE_MARGIN;
    }
    case "gains":
      return !!outcomeOf(r)?.gain || !!leadingFlip(r);
    case "mine":
      return !!mine?.includes(r.id);
    default:
      return true;
  }
}

function matches(r: RaceSummary, f: Filters): boolean {
  if (f.office !== "all" && r.office !== f.office) return false;
  if (f.states.length && !f.states.includes(r.state)) return false;
  if (f.status.length && !f.status.includes(statusOf(r))) return false;
  if (f.tiers.length && !f.tiers.includes(tierOf(r))) return false;
  if (f.leaders.length) {
    const l = leaderOf(r);
    if (!l || !f.leaders.includes(l)) return false;
  }
  if (f.maxMargin !== null) {
    const m = marginOf(r);
    if (m === null || m > f.maxMargin) return false;
  }
  if (f.minReporting !== null && r.reporting < f.minReporting) return false;
  if (f.waves.length && !f.waves.includes(stateFinal(r.state) ?? -1)) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${raceLabel(r)} ${r.title} ${STATE_NAMES[r.state] ?? ""} ${r.state} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(q)) return false;
  return true;
}

/** The groups "closest first" sorts into, in order. */
export type Group = "counting" | "early" | "unknown" | "awaiting" | "called";
export function groupOf(r: RaceSummary): Group {
  const status = statusOf(r);
  if (status === "counting" && r.reportingUnknown) return "unknown";
  return status === "counting" && isEarly(r) ? "early" : status;
}
const GROUP_ORDER: Group[] = ["counting", "early", "unknown", "awaiting", "called"];

/** Uncalled counts tightest first, early counts after them, then races awaiting votes by competitiveness, then calls newest first. */
function byCloseness(a: RaceSummary, b: RaceSummary): number {
  const ga = GROUP_ORDER.indexOf(groupOf(a));
  const gb = GROUP_ORDER.indexOf(groupOf(b));
  const within = ga <= 2 ? marginOf(a)! - marginOf(b)! : ga === 4 ? (b.call?.at ?? 0) - (a.call?.at ?? 0) : 0;
  return ga - gb || within || compareRaces(a, b);
}

const SORTS: Record<Sort, (a: RaceSummary, b: RaceSummary) => number> = {
  close: byCloseness,
  competitive: compareRaces,
  called: (a, b) => (b.call?.at ?? -1) - (a.call?.at ?? -1) || compareRaces(a, b),
  reporting: (a, b) => b.reporting - a.reporting || compareRaces(a, b),
  closing: (a, b) => (stateFinal(a.state) ?? Infinity) - (stateFinal(b.state) ?? Infinity) || compareRaces(a, b),
  state: (a, b) => (STATE_NAMES[a.state] ?? a.state).localeCompare(STATE_NAMES[b.state] ?? b.state) || (a.district ?? 0) - (b.district ?? 0) || a.title.localeCompare(b.title, undefined, { numeric: true }),
};

/** The races passing every filter, in the chosen order. `mine` is the viewer's starred race ids. */
export function explore(races: readonly RaceSummary[], f: Filters, mine: readonly number[] | null): RaceSummary[] {
  return races.filter((r) => matches(r, f) && inView(r, f.view, mine)).sort(SORTS[f.sort]);
}

/** How many races each quick view would show with the other filters as they are. */
export function viewCounts(races: readonly RaceSummary[], f: Filters, mine: readonly number[] | null): Record<View, number> {
  const base = races.filter((r) => matches(r, f));
  const views: View[] = ["all", "key", "uncalled", "close", "gains", "mine"];
  return Object.fromEntries(views.map((v) => [v, base.filter((r) => inView(r, v, mine)).length])) as Record<View, number>;
}

/** How many filters beyond the office, view and sort are set. */
export function activeCount(f: Filters): number {
  return [f.q.trim(), f.states.length, f.status.length, f.tiers.length, f.leaders.length, f.maxMargin !== null, f.minReporting !== null, f.waves.length].filter(Boolean).length;
}

// ---------- URL ----------

/** Every query parameter the filters use, so other parameters on the page can be left alone. */
export const QUERY_KEYS = ["office", "view", "q", "states", "status", "tier", "leader", "margin", "in", "close", "sort"] as const;

const OFFICES = ["senate", "house", "governor", "measure", "all"] as const;
const VIEWS: View[] = ["all", "key", "uncalled", "close", "gains", "mine"];
const SORT_KEYS = Object.keys(SORTS) as Sort[];
const STATUSES: Status[] = ["awaiting", "counting", "called"];
const TIERS: Tier[] = ["tossup", "lean", "likely", "safe", "unrated"];
const LEADERS: Leader[] = ["D", "R", "other", "yes", "no"];
const WAVE_TIMES = new Set(closeWaves().map((w) => w.at));

const list = <T extends string>(raw: string | null, allowed: readonly T[]) => (raw ? raw.split(",").filter((x): x is T => allowed.includes(x as T)) : []);
const num = (raw: string | null, max: number) => {
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

/** Filters from a query string; anything unknown falls back to the default. */
export function fromQuery(params: URLSearchParams, defaults: Filters = DEFAULT_FILTERS): Filters {
  const office = params.get("office");
  const view = params.get("view");
  const sort = params.get("sort");
  return {
    office: OFFICES.includes(office as (typeof OFFICES)[number]) ? (office as Filters["office"]) : defaults.office,
    view: VIEWS.includes(view as View) ? (view as View) : defaults.view,
    q: (params.get("q") ?? "").slice(0, 80),
    states: list(params.get("states"), Object.keys(STATE_NAMES)),
    status: list(params.get("status"), STATUSES),
    tiers: list(params.get("tier"), TIERS),
    leaders: list(params.get("leader"), LEADERS),
    maxMargin: num(params.get("margin"), 100),
    minReporting: num(params.get("in"), 100),
    waves: (params.get("close") ?? "").split(",").map(Number).filter((n) => WAVE_TIMES.has(n)),
    sort: SORT_KEYS.includes(sort as Sort) ? (sort as Sort) : defaults.sort,
  };
}

/** The query string holding every non-default filter. */
export function toQuery(f: Filters, defaults: Filters = DEFAULT_FILTERS): string {
  const p = new URLSearchParams();
  if (f.office !== defaults.office) p.set("office", f.office);
  if (f.view !== defaults.view) p.set("view", f.view);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.states.length) p.set("states", f.states.join(","));
  if (f.status.length) p.set("status", f.status.join(","));
  if (f.tiers.length) p.set("tier", f.tiers.join(","));
  if (f.leaders.length) p.set("leader", f.leaders.join(","));
  if (f.maxMargin !== null) p.set("margin", String(f.maxMargin));
  if (f.minReporting !== null) p.set("in", String(f.minReporting));
  if (f.waves.length) p.set("close", f.waves.join(","));
  if (f.sort !== defaults.sort) p.set("sort", f.sort);
  return p.toString();
}
