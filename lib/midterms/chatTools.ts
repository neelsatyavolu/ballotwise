import { z } from "zod";
import type { Db } from "../auth/accounts";
import { getCached } from "../cache";
import type { AgentTool } from "../grok/agent";
import { callHistory, listCallEvents } from "./calls";
import { otherRace, race } from "./catalog";
import { searchRaces } from "./civic";
import { mergeFound, searchCounty } from "./county";
import { applyAction, layoutSchema, listDashboards, type Action, type Dashboard } from "./dashboard";
import { isState } from "./earlyVote";
import { earlyNation, earlyState, EarlyVoteMissing } from "./earlyVoteSource";
import { statusOf, tierOf } from "./explore";
import type { ChamberView } from "./forecast";
import { listFavorites } from "./favorites";
import { holderOf, leadingFlip, outcomeOf } from "./holders";
import { raceMarkets, type Line, type MarketBook, type Point } from "./marketHistory";
import { CHAMBER_HISTORY_KEY, HISTORY_KEY, POLLS_KEY, raceKey, readOdds, type ChamberHistory, type ForecastHistory, type Signal } from "./odds";
import type { RacePolls } from "./pollAverage";
import { stampTime } from "./polls";
import { balance, type CountyResult, type Office, type RaceSummary } from "./races";
import { raceLabel, STATE_NAMES } from "./view";

/** What the chat's tools read and change: the live races as the overview serves them, and the voter's dashboards. */
export type ChatContext = {
  db: Db;
  userId: string;
  now: number;
  races: readonly RaceSummary[];
  dashboards: readonly Dashboard[];
  openId: string | null;
  background: (work: Promise<unknown>) => void;
};

const OFFICES = ["senate", "house", "governor", "measure"] as const;
const SIDES = ["D", "R", "I"] as const;
const DAY_S = 86_400;

const percents = (odds: Partial<Record<string, number>> | null | undefined) =>
  odds ? Object.fromEntries(Object.entries(odds).map(([side, p]) => [side, Math.round((p ?? 0) * 100)])) : null;

/** The forecast favorite's chance, 0.5 for an even race; 1 without a forecast, so those sort last. */
const favoriteP = (r: RaceSummary) => Math.max(...Object.values(r.signal?.forecast?.odds ?? { x: 1 }).map((p) => p ?? 0));
const marginOf = (r: RaceSummary) => (r.total > 0 && r.candidates[0] ? r.candidates[0].pct - (r.candidates[1]?.pct ?? 0) : null);

/** One race in the compact form every tool lists races in. */
export function raceRow(r: RaceSummary) {
  const [first] = r.candidates;
  const outcome = outcomeOf(r);
  return {
    id: r.id,
    race: raceLabel(r),
    office: r.office,
    state: r.state,
    district: r.district,
    rating: r.rating,
    chances: percents(r.signal?.forecast?.odds),
    holder: holderOf(r),
    status: statusOf(r),
    reporting: r.reportingUnknown ? null : r.reporting,
    votes: r.total,
    leader: r.total > 0 && first ? `${first.name} (${first.party}) ${first.pct}%` : null,
    margin: marginOf(r),
    calledFor: r.calledFor ?? null,
    flip: outcome?.gain ? `${outcome.side} gain` : leadingFlip(r) ? `${leadingFlip(r)} leads a seat held by ${holderOf(r)}` : null,
    votesAddedLast15Min: r.trend?.votesAdded ?? null,
  };
}

const findArgs = z.object({
  office: z.array(z.enum(OFFICES)).optional().describe("Offices to include; all when left out."),
  states: z.array(z.string().length(2)).optional().describe("Two-letter state codes."),
  tiers: z.array(z.enum(["tossup", "lean", "likely", "safe", "unrated"])).optional().describe("Forecast tiers."),
  status: z.array(z.enum(["awaiting", "counting", "called"])).optional(),
  favored: z.enum(SIDES).optional().describe("Only races whose forecast favorite is this side."),
  holder: z.enum(SIDES).optional().describe("Only seats held by this party going in."),
  flips: z.boolean().optional().describe("Only races called for, or led by, a party other than the one holding the seat."),
  maxMargin: z.number().optional().describe("Only counted races whose leader is ahead by at most this many points."),
  minReporting: z.number().optional().describe("Only races with at least this percent of the expected vote counted."),
  text: z.string().max(80).optional().describe("Matched against race titles and candidate names."),
  starred: z.boolean().optional().describe("Only races the voter starred."),
  sort: z.enum(["closest_forecast", "closest_count", "most_reporting", "votes_added", "state"]).default("closest_forecast"),
  limit: z.number().int().min(1).max(150).default(40),
});

/** The races matching `f`, sorted and cut to its limit. */
export function findRaces(races: readonly RaceSummary[], f: z.infer<typeof findArgs>, starred: readonly number[]) {
  const text = f.text?.toLowerCase();
  const states = f.states?.map((s) => s.toUpperCase());
  const matched = races.filter((r) => {
    if (f.office && !f.office.includes(r.office)) return false;
    if (states && !states.includes(r.state)) return false;
    if (f.tiers && !f.tiers.includes(tierOf(r))) return false;
    if (f.status && !f.status.includes(statusOf(r))) return false;
    if (f.favored) {
      const odds = r.signal?.forecast?.odds ?? {};
      if (!((odds[f.favored] ?? 0) > 0.5)) return false;
    }
    if (f.holder && holderOf(r) !== f.holder) return false;
    if (f.flips && !(outcomeOf(r)?.gain || leadingFlip(r))) return false;
    const margin = marginOf(r);
    if (f.maxMargin !== undefined && (margin === null || margin > f.maxMargin)) return false;
    if (f.minReporting !== undefined && (r.reportingUnknown || r.reporting < f.minReporting)) return false;
    if (text && !`${r.title} ${raceLabel(r)} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(text)) return false;
    if (f.starred && !starred.includes(r.id)) return false;
    return true;
  });
  const key: Record<typeof f.sort, (r: RaceSummary) => number | string> = {
    closest_forecast: favoriteP,
    closest_count: (r) => marginOf(r) ?? Infinity,
    most_reporting: (r) => -r.reporting,
    votes_added: (r) => -(r.trend?.votesAdded ?? 0),
    state: (r) => `${r.state}${String(r.district ?? 0).padStart(3, "0")}`,
  };
  const sorted = [...matched].sort((a, b) => {
    const [x, y] = [key[f.sort](a), key[f.sort](b)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { matched: matched.length, races: sorted.slice(0, f.limit).map(raceRow) };
}

function signalOut(signal: Signal | null | undefined) {
  if (!signal) return null;
  const { forecast, market, polls } = signal;
  return {
    market: market && { chances: percents(market.odds), sources: market.sources, volume: market.volume ?? null },
    pollAverage: polls && { leftMinusRepublican: polls.margin, polls: polls.count, latest: polls.latest, left: polls.left ?? "D" },
    forecast: forecast && { ...forecast, odds: undefined, chances: percents(forecast.odds) },
  };
}

function countyRow(c: CountyResult) {
  return {
    name: c.name,
    reporting: c.reportingUnknown ? null : c.reporting,
    votes: c.total,
    results: c.candidates.slice(0, 3).map((x) => `${x.name} ${x.pct}%`).join(" · "),
    harrisMinusTrump2024: c.baseline2024,
  };
}

/** Daily values for the last two weeks, weekly before that. */
function thinDays<T>(days: readonly string[], values: readonly T[]): { day: string; value: T }[] {
  const out = days.map((day, i) => ({ day, value: values[i] }));
  return out.filter((_, i) => i >= out.length - 14 || (out.length - 1 - i) % 7 === 0);
}

async function raceDetail(ctx: ChatContext, id: number, counties: boolean, countyLimit: number) {
  const found = (await race(ctx.db, id, ctx.now, ctx.background)) ?? (await otherRace(id, ctx.now));
  if (!found) return { error: `There's no race with id ${id}. Use find_races or search_local_races to find one.` };
  const r = found.race;
  // Races found by search_local_races have no forecast or call log.
  const [history, calls] = ctx.races.some((x) => x.id === id)
    ? await Promise.all([getCached<ForecastHistory>(ctx.db, HISTORY_KEY, ctx.now), callHistory(ctx.db, id)])
    : [null, []];
  const line = history?.races[raceKey(r.office, r.state, r.district)];
  const byVotes = [...r.counties].sort((a, b) => b.total - a.total);
  return {
    ...raceRow(r),
    title: r.title,
    candidates: r.candidates.map((c) => ({ name: c.name, party: c.party, votes: c.votes, pct: c.pct, incumbent: c.incumbent, winner: c.winner })),
    pollsClose: r.pollsClose,
    resultsUpdated: r.updated,
    rankedChoice: r.rcv ? { round: r.round ?? null } : undefined,
    about: r.about,
    local: r.local,
    call: r.call ? { ...r.call, at: stampTime(r.call.at) } : null,
    callPending: found.callPending,
    callHistory: calls.map((e) => ({ kind: e.kind, winner: e.winner, previous: e.previous, at: stampTime(e.at) })),
    stale: found.stale,
    signal: signalOut(r.signal),
    forecastHistory: line && history ? { side: line.side, chanceBySide: thinDays(history.days, line.p.map((p) => (p === null ? null : Math.round(p * 100)))) } : null,
    recentCount: "history" in found ? found.history.map((o) => ({ ...o, at: stampTime(o.at) })) : [],
    counties: counties
      ? { total: r.counties.length, shown: Math.min(countyLimit, r.counties.length), byVotes: byVotes.slice(0, countyLimit).map(countyRow) }
      : `${r.counties.length} counties; call again with counties: true for them.`,
  };
}

async function racePolls(ctx: ChatContext, r: RaceSummary, limit: number) {
  const polls = (await getCached<Record<string, RacePolls>>(ctx.db, POLLS_KEY, ctx.now))?.[raceKey(r.office, r.state, r.district)];
  if (!polls) return { race: raceLabel(r), error: "We have no polls for this race." };
  const trend = polls.trend.filter((_, i, all) => (all.length - 1 - i) % 7 === 0).slice(-12);
  return {
    race: raceLabel(r),
    left: { name: polls.leftName, side: polls.left },
    right: { name: polls.rightName, side: "R" },
    average: polls.average,
    weeklyTrend: trend.map(([t, left, right]) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), left, right })),
    polls: [...polls.rows].sort((a, b) => b.end.localeCompare(a.end)).slice(0, limit),
    totalPolls: polls.rows.length,
  };
}

/** A price (in percent) at or before `t` in unix seconds; null when the market hadn't opened. */
function priceAt(points: readonly Point[], t: number): number | null {
  let found: number | null = null;
  for (const [at, p] of points) if (at <= t) found = p;
  return found === null ? null : Math.round(found * 100);
}

function bookOut(book: MarketBook | null, nowS: number) {
  if (!book) return null;
  const outcome = (l: Line) => {
    const points = [...l.all, ...l.live].sort((a, b) => a[0] - b[0]);
    return {
      name: l.name,
      side: l.side,
      now: Math.round(l.now * 100),
      dayAgo: priceAt(points, nowS - DAY_S),
      weekAgo: priceAt(points, nowS - 7 * DAY_S),
      monthAgo: priceAt(points, nowS - 30 * DAY_S),
      atOpen: points[0] ? Math.round(points[0][1] * 100) : null,
    };
  };
  return { question: book.question, url: book.url, outcomes: book.lines.map(outcome) };
}

/** Seat counts at the 10th, 50th and 90th percentile of the simulations, and the five likeliest totals. */
function seatRange(distribution: ChamberView["distribution"]) {
  const sorted = [...distribution].sort((a, b) => a.seats - b.seats);
  const at = (q: number) => {
    let sum = 0;
    return sorted.find((d) => (sum += d.p) >= q)?.seats ?? null;
  };
  return {
    p10: at(0.1),
    median: at(0.5),
    p90: at(0.9),
    likeliest: [...distribution].sort((a, b) => b.p - a.p).slice(0, 5).map((d) => ({ dSeats: d.seats, chance: Math.round(d.p * 1000) / 10 })),
  };
}

async function chamberForecast(ctx: ChatContext, chamber: "house" | "senate" | "governor" | undefined) {
  const [odds, history] = await Promise.all([readOdds(ctx.db, ctx.now), getCached<ChamberHistory>(ctx.db, CHAMBER_HISTORY_KEY, ctx.now)]);
  const now = balance(ctx.races);
  const one = (c: "house" | "senate" | "governor") => {
    const view = odds?.chambers?.[c];
    const points = history?.[c] ?? [];
    return {
      demsControlChance: view ? Math.round(view.dControl * 100) : null,
      expectedSeats: view && { D: Math.round(view.dSeats * 10) / 10, R: Math.round(view.rSeats * 10) / 10 },
      majority: view?.majority,
      notUp: view?.notUp,
      racesByRating: view?.ratings,
      demSeatRange: view && seatRange(view.distribution),
      calledSoFar: now[c],
      history: thinDays(points.map((p) => p[0]), points.map(([, d, ds, rs]) => ({ demsControlChance: Math.round(d * 100), dSeats: ds, rSeats: rs }))),
    };
  };
  const chambers = chamber ? [chamber] : (["house", "senate", "governor"] as const);
  return {
    updated: odds ? stampTime(odds.at) : null,
    genericBallot: odds?.polls?.generic ?? null,
    ...Object.fromEntries(chambers.map((c) => [c, one(c)])),
  };
}

async function earlyVote(state: string | undefined) {
  try {
    if (!state) {
      const n = await earlyNation();
      return { asOf: n.asOf, states: [...n.states].sort((a, b) => b.cast - a.cast) };
    }
    const s = await earlyState(state);
    return { ...s, counties: [...s.counties].sort((a, b) => b.cast - a.cast).slice(0, 25), countyCount: s.counties.length };
  } catch (err) {
    if (err instanceof EarlyVoteMissing) return { error: err.message };
    throw err;
  }
}

const dashboardHint = "Use only race ids from the race list; 1-8 sections, each under 40 races, most important first. Each note is one short neutral sentence.";

/**
 * The chat assistant's tools over the tracker's data. Dashboard changes are applied as they're called; `onChange`
 * hears which dashboard to show next.
 */
export function chatTools(ctx: ChatContext, onChange: (focusId: string | null) => void): AgentTool<never>[] {
  const byId = new Map(ctx.races.map((r) => [r.id, r]));
  const name = (id: number) => (byId.get(id) ? raceLabel(byId.get(id)!) : `race ${id}`);
  const tracked = (id: number) => {
    const r = byId.get(id);
    if (!r || r.office === "measure") throw new Error(`Race ${id} isn't a tracked Senate, House or governor race.`);
    return r;
  };
  // The dashboards as last read, so a second change in one turn isn't refused as a concurrent edit.
  let seen = ctx.dashboards;
  let openId = ctx.openId;
  const act = async (action: Action) => {
    const focus = await applyAction(ctx.db, ctx.userId, action, ctx.races, openId, Date.now(), seen);
    seen = await listDashboards(ctx.db, ctx.userId);
    openId = focus;
    onChange(focus);
    return { ok: true, dashboardId: focus };
  };

  const tools = [
    {
      name: "find_races",
      description: "Filter and sort every tracked race (Senate, House, governor, statewide measures). Returns each race's forecast chances, holder, count status, leader, margin, call and flips.",
      args: findArgs,
      label: () => "Searching the races",
      run: async (a: z.infer<typeof findArgs>) => findRaces(ctx.races, a, a.starred ? await listFavorites(ctx.db, ctx.userId) : []),
    },
    {
      name: "get_race",
      description: "Everything about one race: all candidates and votes, the forecast's inputs (market, polls, fundamentals, 2024 lean, incumbency, fundraising, experts), its daily forecast history, recent vote-count changes, call history, and optionally county results with each county's 2024 presidential margin. Works for local races found by search_local_races too.",
      args: z.object({
        id: z.number().int(),
        counties: z.boolean().default(false).describe("Include county results, largest first."),
        countyLimit: z.number().int().min(1).max(400).default(60),
      }),
      label: (a: { id: number }) => `Reading ${name(a.id)}`,
      run: (a: { id: number; counties: boolean; countyLimit: number }) => raceDetail(ctx, a.id, a.counties, a.countyLimit),
    },
    {
      name: "get_race_polls",
      description: "A Senate, House or governor race's polls: the average, a weekly trend, and the latest polls with pollster, dates, sample, margin, and whether each is partisan, internal or left out of the average.",
      args: z.object({ id: z.number().int(), limit: z.number().int().min(1).max(60).default(15) }),
      label: (a: { id: number }) => `${name(a.id)} polls`,
      run: (a: { id: number; limit: number }) => racePolls(ctx, tracked(a.id), a.limit),
    },
    {
      name: "get_market_history",
      description: "A race's Kalshi and Polymarket prices now, a day, a week and a month ago, and at open, per outcome, in percent.",
      args: z.object({ id: z.number().int() }),
      label: (a: { id: number }) => `${name(a.id)} market prices`,
      run: async (a: { id: number }) => {
        const m = await raceMarkets(ctx.db, tracked(a.id), ctx.now);
        const nowS = Math.floor(ctx.now / 1000);
        return { race: name(a.id), kalshi: bookOut(m.kalshi, nowS), polymarket: bookOut(m.polymarket, nowS) };
      },
    },
    {
      name: "get_chamber_forecast",
      description: "Chamber control: Democrats' chance of controlling the House, Senate and a majority of governorships, expected seats, the seat range across 10,000 simulations, races by rating, seats called so far, the forecast's daily history, and the generic ballot.",
      args: z.object({ chamber: z.enum(["house", "senate", "governor"]).optional() }),
      label: () => "Chamber forecasts",
      run: (a: { chamber?: "house" | "senate" | "governor" }) => chamberForecast(ctx, a.chamber),
    },
    {
      name: "get_early_vote",
      description: "Early voting. Without a state: every reporting state's ballots requested, returned, cast in person, party split, and 2024 turnout to compare. With a state: its totals, largest counties, demographics, the same day in 2024, and an estimated lean.",
      args: z.object({ state: z.string().length(2).optional() }),
      label: (a: { state?: string }) => (a.state ? `${STATE_NAMES[a.state.toUpperCase()] ?? a.state} early vote` : "Early vote nationwide"),
      run: (a: { state?: string }) => {
        const state = a.state?.toUpperCase();
        if (state && !isState(state)) throw new Error(`${a.state} isn't a state code.`);
        return earlyVote(state);
      },
    },
    {
      name: "get_race_calls",
      description: "The latest race calls, changed calls and withdrawn calls, newest first, with when we saw each.",
      args: z.object({ office: z.enum(OFFICES).optional(), limit: z.number().int().min(1).max(100).default(30) }),
      label: () => "Recent race calls",
      run: async (a: { office?: Office; limit: number }) =>
        (await listCallEvents(ctx.db, a)).map((e) => ({ race: name(e.raceId), raceId: e.raceId, kind: e.kind, winner: e.winner, party: e.party, previous: e.previous, at: stampTime(e.at) })),
    },
    {
      name: "search_local_races",
      description: "Search races outside the tracked offices by name or place: mayors, city councils, school boards, local measures. Pass a returned id to get_race for results.",
      args: z.object({ query: z.string().min(2).max(80) }),
      label: (a: { query: string }) => `Searching local races for “${a.query}”`,
      run: async (a: { query: string }) => {
        const [civic, county] = await Promise.allSettled([searchRaces(a.query, ctx.now), searchCounty(a.query, ctx.now)]);
        if (civic.status === "rejected" && county.status === "rejected") throw new Error("Search is unavailable right now.");
        return mergeFound(a.query, county.status === "fulfilled" ? county.value : [], civic.status === "fulfilled" ? civic.value : []);
      },
    },
    {
      name: "create_dashboard",
      description: `Create a dashboard of race cards for the voter. ${dashboardHint}`,
      args: z.object({ layout: layoutSchema }),
      label: (a: { layout: { title: string } }) => `Building “${a.layout.title}”`,
      run: (a: { layout: z.infer<typeof layoutSchema> }) => act({ type: "create", layout: a.layout }),
    },
    {
      name: "update_dashboard",
      description: `Replace one of the voter's dashboards with its full new layout, keeping what they didn't ask to change. ${dashboardHint}`,
      args: z.object({ dashboardId: z.string(), layout: layoutSchema }),
      label: (a: { layout: { title: string } }) => `Updating “${a.layout.title}”`,
      run: (a: { dashboardId: string; layout: z.infer<typeof layoutSchema> }) => act({ type: "update", dashboardId: a.dashboardId, layout: a.layout }),
    },
    {
      name: "delete_dashboard",
      description: "Delete one of the voter's dashboards. Only when they clearly ask to.",
      args: z.object({ dashboardId: z.string() }),
      label: () => "Deleting a dashboard",
      run: (a: { dashboardId: string }) => act({ type: "delete", dashboardId: a.dashboardId }),
    },
  ];
  return tools as unknown as AgentTool<never>[];
}
