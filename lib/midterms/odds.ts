import type { Db } from "../auth/accounts";
import { getCached, putCached } from "../cache";
import { chamberViews, forecastRace, leanBucket, matchup, PARAMS, ratingOf, TUNING, type Chambers, type Forecast, type Inputs, type Matchup, type Side, type Tuning } from "./forecast";
import divisions from "./divisions.json";
import fec2026 from "./fec2026.json";
import lean2026 from "./lean2026.json";
import experts2026 from "./experts2026.json";
import personal2026 from "./personal2026.json";
import { aggregateMedian, fetchAggregates, type Aggregate } from "./genericAggregates";
import { genericBallot, independentLeads, lastName, racePolls, RECENT_FULL, type RacePolls, type TrendPoint, type VoteHubPoll } from "./pollAverage";
import type { Office, RaceSummary, RatedRace, Rating } from "./races";
import { STATE_NAMES } from "./view";
import { fetchWikiPolls, mergePolls } from "./wikiPolls";

// Race forecasts and ratings (lib/midterms/forecast.ts) computed live from the 2024 presidential lean, the generic
// ballot, polls (VoteHub, CC BY 4.0) and prediction markets (Kalshi, Polymarket). A scheduled job refreshes them
// every few minutes; pages read the saved result.

export type { Side };
/** `volume` is the traded volume behind the price (Kalshi contracts plus Polymarket dollars); absent in older snapshots. */
export type Market = { odds: Partial<Record<Side, number>>; sources: ("Kalshi" | "Polymarket")[]; volume?: number };
/** `left` is the side the margin measures against the Republican; absent (the Democrat) in older snapshots. */
export type Polls = { margin: number; count: number; latest: string; left?: "D" | "I" };
/**
 * The generic ballot the forecast uses: our own average of VoteHub's polls, filled in from the median of public
 * aggregators in proportion to how few polls our feed has from the last two weeks (full trust at five). `recent`
 * counts those polls.
 */
export type Generic = { margin: number; count: number; own?: number; recent?: number; aggregate?: { margin: number; sources: Aggregate[] } | null };
export type Signal = { market: Market | null; polls: Polls | null; rating: Rating | null; forecast?: Forecast | null };
/** One source's price for a race, with the volume traded on it. */
export type Quote = { odds: Partial<Record<Side, number>>; volume: number };
type Book = Record<string, Quote>;
/** Each source is kept with the time it was last fetched successfully, so one outage keeps the others' data. */
export type OddsSnapshot = {
  at: number;
  kalshi: { at: number; book: Book } | null;
  polymarket: { at: number; book: Book } | null;
  polls: { at: number; averages: Record<string, Polls>; generic?: Generic | null } | null;
  signals: Record<string, Signal>;
  /** Simulated chamber control from the race forecasts. */
  chambers?: Chambers | null;
};
/** [ET day, Democrats' chance of control, D seats, R seats]: one point per day for each chamber. */
export type ChamberPoint = [string, number, number, number];
/** `backfilled` marks days recomputed later from what was known on each day, without markets. */
export type ChamberHistory = { house: ChamberPoint[]; senate: ChamberPoint[]; governor: ChamberPoint[]; backfilled?: { from: string; to: string; markets: "none" } };
/** Each race's left-side forecast chance per day (ET dates), for the race page's chart. */
export type ForecastHistory = { days: string[]; races: Record<string, { side: Side; p: (number | null)[] }> };

const KEY = "midterms:odds";
/** Per-race poll lists and trends, written only when polls are refreshed, so page views don't carry them. */
export const POLLS_KEY = "midterms:polls";
export const HISTORY_KEY = "midterms:forecast-history";
export const CHAMBER_HISTORY_KEY = "midterms:chamber-history";
/** The first day the history is recomputed back to. */
const BACKFILL_FROM = "2026-08-01";
const LEAN = lean2026 as { house: Record<string, number>; state: Record<string, number>; incumbents: Record<string, string> };
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2/markets";
const POLYMARKET = "https://gamma-api.polymarket.com/events";
const VOTEHUB = "https://api.votehub.com/polls";
/** Polls change slowly; markets are refreshed on every run, polls at most this often. */
export const POLLS_EVERY_MS = 30 * 60 * 1000;
/** Market prices older than this (a source down for hours) are dropped rather than shown as current. */
const MARKETS_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** Poll averages kept through a VoteHub outage for at most this long. */
const POLLS_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const TICKERS_PER_CALL = 150;
/** Kalshi rate-limits bursts: requests are spaced out, and a 429 is retried after these waits. */
const KALSHI_GAP_MS = 400;
const KALSHI_RETRY_MS = [2000, 6000];

export const raceKey = (office: Office, state: string, district: number | null | undefined) => `${office}:${state}:${office === "house" ? (district ?? 0) : ""}`;
const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([postal, name]) => [name.toLowerCase(), postal]));

// ---------- Forecast ----------

const sideOf = (party: string): Side | null => (/^democrat/i.test(party) ? "D" : /^republican/i.test(party) ? "R" : /independent/i.test(party) ? "I" : null);

const firstInitial = (name: string) => name.trim().toLowerCase().normalize("NFD").replace(/[^a-z]/g, " ").trim()[0] ?? "";
/** Each state's sitting House members, for members running in another district after redistricting. */
const HOUSE_MEMBERS = Object.entries(LEAN.incumbents).reduce<Record<string, string[]>>((acc, [k, name]) => {
  const [office, state] = k.split(":");
  return office === "house" ? { ...acc, [state]: [...(acc[state] ?? []), name] } : acc;
}, {});

/**
 * The side whose incumbent is on the ballot: a candidate sharing the seat holder's last name, or, in a House race, a
 * sitting member from another district of the state (same first initial and last name) running after redistricting.
 */
export function incumbentSide(r: Pick<RaceSummary, "office" | "state" | "district" | "candidates">): Side | null {
  const holder = LEAN.incumbents[raceKey(r.office, r.state, r.district)];
  const running = holder ? r.candidates.find((c) => lastName(c.name) === lastName(holder)) : undefined;
  if (running) return sideOf(running.party);
  if (r.office !== "house") return null;
  const moved = r.candidates.find((c) => (HOUSE_MEMBERS[r.state] ?? []).some((m) => lastName(m) === lastName(c.name) && firstInitial(m) === firstInitial(c.name)));
  return moved ? sideOf(moved.party) : null;
}

/** The seat's 2024 presidential margin: the district's for House races, the state's otherwise. */
export const leanOf = (r: Pick<RaceSummary, "office" | "state" | "district">): number | null =>
  (r.office === "house" ? LEAN.house[raceKey("house", r.state, r.district)] : LEAN.state[r.state]) ?? null;

const RECEIPTS = fec2026 as Record<string, { D: number; R: number }>;

/** ln(Democrat's receipts / Republican's) from FEC's 2026 candidate summaries, capped at ±3, as in the fit; null without both. */
export function fundraisingOf(r: Pick<RaceSummary, "office" | "state" | "district">): number | null {
  const m = RECEIPTS[raceKey(r.office, r.state, r.district)];
  if (!m?.D || !m.R) return null;
  return Math.max(-3, Math.min(3, Math.log(Math.max(m.D, 5000) / Math.max(m.R, 5000))));
}

const PERSONAL = personal2026 as Record<string, Partial<Record<Side, { last: string; value: number }>>>;

/** The running incumbent's personal vote from their last win in the seat (scripts/fit-forecast.mjs); null without one. */
export function personalOf(r: Pick<RaceSummary, "office" | "state" | "district" | "candidates">): number | null {
  const side = incumbentSide(r);
  return side ? (PERSONAL[raceKey(r.office, r.state, r.district)]?.[side]?.value ?? null) : null;
}

type ExpertRating = { category: keyof typeof PARAMS.experts; side: Side | null; date: string | null };
const EXPERTS = experts2026 as Record<string, Partial<Record<"cook" | "insideElections" | "sabato", ExpertRating>>>;

/** The Cook Political Report's, Inside Elections' and Sabato's Crystal Ball's ratings of a race (scripts/build-experts.mjs), as chances. */
export function expertsOf(r: Pick<RaceSummary, "office" | "state" | "district">): { side: Side | null; p: number }[] | null {
  const ratings = Object.values(EXPERTS[raceKey(r.office, r.state, r.district)] ?? {});
  return ratings.length ? ratings.map((e) => ({ side: e.side, p: PARAMS.experts[e.category] })) : null;
}

/** What the forecast of one race is computed from: who it's between, and its inputs. */
export function raceInputs(r: RaceSummary, market: Market | null, polls: Polls | null, generic: number | null): { matchup: Matchup; inputs: Inputs } {
  return { matchup: matchup(r, LEAN.incumbents[raceKey(r.office, r.state, r.district)], polls?.left), inputs: { office: r.office, lean: leanOf(r), genericBallot: generic, incumbent: incumbentSide(r), personal: personalOf(r), fundraising: fundraisingOf(r), polls, market, experts: expertsOf(r) } };
}

/** One race's forecast from its market, polls and the generic ballot; null for measures and races nothing separates. */
export function raceForecast(r: RaceSummary, market: Market | null, polls: Polls | null, generic: number | null, t: Tuning = TUNING): Forecast | null {
  if (r.office === "measure") return null;
  const { matchup: m, inputs } = raceInputs(r, market, polls, generic);
  return forecastRace(m, inputs, t);
}

// ---------- Kalshi ----------

type KalshiMarket = { ticker: string; event_ticker?: string; yes_bid_dollars?: string; yes_ask_dollars?: string; last_price_dollars?: string; volume_fp?: string; status?: string };

function kalshiPrice(m: KalshiMarket): number | null {
  const bid = Number(m.yes_bid_dollars);
  const ask = Number(m.yes_ask_dollars);
  // A tight book's midpoint is the market's price; a wide one says little, so fall back to the last trade.
  if (bid > 0 && ask > 0 && ask - bid <= 0.15) return (bid + ask) / 2;
  const last = Number(m.last_price_dollars);
  return Number.isFinite(last) && last > 0 ? last : null;
}

/** Which race and party a 2026 Kalshi market is about, from its ticker alone. */
export function kalshiRace(ticker: string): { key: string; side: Side } | null {
  let m = ticker.match(/^SENATE([A-Z]{2})S?-26-([DRI])$/);
  if (m) return { key: raceKey("senate", m[1], null), side: m[2] as Side };
  m = ticker.match(/^(?:KX)?GOVPARTY-?([A-Z]{2})-26-([DRI])$/);
  if (m) return { key: raceKey("governor", m[1], null), side: m[2] as Side };
  m = ticker.match(/^KXHOUSERACE-([A-Z]{2})(\d{2}|AL)-26-([DRI])$/);
  if (m) return { key: raceKey("house", m[1], m[2] === "AL" ? 0 : Number(m[2])), side: m[3] as Side };
  m = ticker.match(/^(?:KX)?HOUSE([A-Z]{2})(\d+|AL)-26-([DRI])$/);
  if (m) return { key: raceKey("house", m[1], m[2] === "AL" ? 0 : Number(m[2])), side: m[3] as Side };
  return null;
}

/**
 * Normalized win chances and volume per race from Kalshi markets. When a race is listed twice, the busier market wins.
 * `independents` names races with an independent candidate Kalshi may not list (see normalize).
 */
export function parseKalshi(markets: readonly KalshiMarket[], independents: ReadonlySet<string> = new Set()): Map<string, Quote> {
  const best = new Map<string, { side: Side; price: number; volume: number }[]>();
  const byEvent = new Map<string, { key: string; entries: { side: Side; price: number; volume: number }[] }>();
  for (const m of markets) {
    if (m.status && m.status !== "active" && m.status !== "open") continue;
    const race = kalshiRace(m.ticker);
    const price = kalshiPrice(m);
    if (!race || price === null) continue;
    const event = m.event_ticker ?? m.ticker.replace(/-[DRI]$/, "");
    const entry = byEvent.get(event) ?? { key: race.key, entries: [] };
    entry.entries.push({ side: race.side, price, volume: Number(m.volume_fp) || 0 });
    byEvent.set(event, entry);
  }
  const volume = (list: { volume: number }[]) => list.reduce((s, e) => s + e.volume, 0);
  for (const { key, entries } of byEvent.values()) {
    const prev = best.get(key);
    if (!prev || volume(entries) > volume(prev)) best.set(key, entries);
  }
  return new Map([...best].map(([key, entries]) => [key, { odds: normalize(entries, independents.has(key)), volume: volume(entries) }]));
}

/**
 * Turns "Yes" prices into win chances that add to 1. When the listed sides add to well under 1, some outcome has
 * no usable price, and the missing share goes where it must belong: to the other major party when only one of
 * D and R is priced, or, when both are, to the independent the race has but Kalshi doesn't list (Nebraska's Senate race).
 * Otherwise the prices are scaled to add to 1.
 */
function normalize(entries: readonly { side: Side; price: number }[], hasIndependent = false): Partial<Record<Side, number>> {
  const total = entries.reduce((s, e) => s + e.price, 0);
  if (!total) return {};
  const priced = new Set(entries.map((e) => e.side));
  let short = 0;
  let missingSide: Side | null = null;
  if (priced.has("D") !== priced.has("R") && total < 1) {
    // Only one major party has a price: the other gets whatever is left.
    missingSide = priced.has("D") ? "R" : "D";
    short = 1 - total;
  } else if (total < 0.9 && hasIndependent && !priced.has("I")) {
    missingSide = "I";
    short = 1 - total;
  }
  const scale = missingSide ? 1 : total;
  const out: Partial<Record<Side, number>> = {};
  for (const e of entries) out[e.side] = (out[e.side] ?? 0) + e.price / scale;
  if (missingSide) out[missingSide] = (out[missingSide] ?? 0) + short;
  return out;
}

/** Every ticker worth asking Kalshi for, given the tracked races; nonexistent ones are simply not returned. */
export function kalshiTickers(races: readonly RaceSummary[], houseCovered: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const r of races) {
    if (r.office === "senate") for (const s of ["", "S"]) out.push(`SENATE${r.state}${s}-26-D`, `SENATE${r.state}${s}-26-R`);
    if (r.office === "governor") for (const p of ["GOVPARTY", "KXGOVPARTY"]) out.push(`${p}${r.state}-26-D`, `${p}${r.state}-26-R`);
    if (r.office === "house" && !houseCovered.has(raceKey("house", r.state, r.district))) {
      const d = r.district === 0 ? "AL" : String(r.district);
      for (const p of ["HOUSE", "KXHOUSE"]) out.push(`${p}${r.state}${d}-26-D`, `${p}${r.state}${d}-26-R`);
    }
  }
  return out;
}

// ---------- Polymarket ----------

type PolyEvent = { title?: string; volume?: number | string; markets?: { question?: string; groupItemTitle?: string; outcomePrices?: string; active?: boolean; closed?: boolean }[] };

export function polySide(text: string): Side | null {
  const tag = text.match(/\((D|R|I)\)/);
  if (tag) return tag[1] as Side;
  if (/democrat/i.test(text)) return "D";
  if (/republican/i.test(text)) return "R";
  if (/independent/i.test(text)) return "I";
  return null;
}

/** The race a Polymarket winner event is about: "{State} Senate|Governor Election Winner" or "PA-07 House Election Winner". */
export function polyRace(title: string | undefined): string | null {
  const t = title?.trim() ?? "";
  const statewide = t.match(/^(.+?) (Senate|Governor) Election Winner$/);
  if (statewide) {
    const state = STATE_BY_NAME.get(statewide[1].toLowerCase());
    return state ? raceKey(statewide[2] === "Senate" ? "senate" : "governor", state, null) : null;
  }
  const house = t.match(/^([A-Z]{2})-(\d+|AL) House Election Winner$/);
  return house ? raceKey("house", house[1], house[2] === "AL" ? 0 : Number(house[2])) : null;
}

/** Normalized win chances and volume per race from Polymarket's winner events. When a race appears twice, the busier event wins. */
export function parsePolymarket(events: readonly PolyEvent[]): Map<string, Quote> {
  const best = new Map<string, Quote>();
  for (const e of events) {
    const key = polyRace(e.title);
    if (!key) continue;
    const entries: { side: Side; price: number }[] = [];
    for (const mk of e.markets ?? []) {
      if (mk.active === false || mk.closed || !mk.outcomePrices) continue;
      const side = polySide(`${mk.groupItemTitle ?? ""} ${mk.question ?? ""}`);
      let yes: number;
      try {
        yes = Number((JSON.parse(mk.outcomePrices) as string[])[0]);
      } catch {
        continue;
      }
      if (side && Number.isFinite(yes)) entries.push({ side, price: yes });
    }
    const volume = Number(e.volume) || 0;
    if (entries.length && (!best.has(key) || volume > best.get(key)!.volume)) best.set(key, { volume, odds: normalize(entries) });
  }
  return best;
}

/**
 * Averages each race's chances across the markets that price it, the busier market counting more. Calibration
 * improves with volume, but neither exchange has proven more accurate than the other once you account for the
 * kinds of markets each lists (Clinton and Huang, 2025), so the weight grows only with the log of volume.
 */
export function combineMarkets(kalshi: Map<string, Quote>, poly: Map<string, Quote>): Map<string, Market> {
  const out = new Map<string, Market>();
  for (const key of new Set([...kalshi.keys(), ...poly.keys()])) {
    const found = [kalshi.has(key) && { src: "Kalshi" as const, ...kalshi.get(key)! }, poly.has(key) && { src: "Polymarket" as const, ...poly.get(key)! }].filter(
      (x): x is { src: "Kalshi" | "Polymarket" } & Quote => !!x && Object.keys(x.odds).length > 0,
    );
    if (!found.length) continue;
    const weights = found.map((f) => Math.log10(10 + f.volume));
    const total = weights.reduce((s, w) => s + w, 0);
    const odds: Partial<Record<Side, number>> = {};
    for (const side of ["D", "R", "I"] as Side[]) {
      const mean = found.reduce((s, f, i) => s + (f.odds[side] ?? 0) * weights[i], 0) / total;
      if (mean > 0) odds[side] = Math.round(mean * 1000) / 1000;
    }
    out.set(key, { odds, sources: found.map((f) => f.src), volume: Math.round(found.reduce((s, f) => s + f.volume, 0)) });
  }
  return out;
}

// ---------- Polls (VoteHub) ----------

/** The race a general-election poll is about: "2026 Michigan" (statewide) or "2026 PA-07" (House). Primaries don't match. */
function pollRace(poll: VoteHubPoll, office: Office): string | null {
  const subject = poll.subject?.match(/^2026 (.+)$/)?.[1]?.trim();
  if (!subject) return null;
  if (office === "house") {
    const m = (poll.seat_name ?? subject).match(/^([A-Z]{2})-(\d+|AL)$/);
    return m ? raceKey("house", m[1], m[2] === "AL" ? 0 : Number(m[2])) : null;
  }
  const state = STATE_BY_NAME.get(subject.toLowerCase());
  return state ? raceKey(office, state, null) : null;
}

/**
 * Each contested race's polls of one office, averaged the DDHQ way (lib/midterms/pollAverage.ts). The poll's subject
 * names the race; answers are matched to the race's two sides by last name.
 */
export function officePolls(polls: readonly VoteHubPoll[], office: Office, races: readonly RaceSummary[], now: number): Map<string, RacePolls> {
  const byKey = new Map<string, VoteHubPoll[]>();
  for (const poll of polls) {
    const key = pollRace(poll, office);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), poll]);
  }
  const out = new Map<string, RacePolls>();
  for (const r of races) {
    if (r.office !== office) continue;
    const key = raceKey(r.office, r.state, r.district);
    const list = byKey.get(key);
    const withDemocrat = matchup(r, LEAN.incumbents[key]);
    const withIndependent = matchup(r, LEAN.incumbents[key], "I");
    // A three-way race is forecast against whichever of the Democrat and the independent polls higher.
    const m =
      withDemocrat.kind === "contest" && withIndependent.kind === "contest" && withDemocrat.left !== withIndependent.left && independentLeads(list ?? [], withDemocrat.leftName, withIndependent.leftName, now)
        ? withIndependent
        : withDemocrat;
    if (m.kind !== "contest" || !list?.length) continue;
    out.set(key, racePolls(list, m, now));
  }
  return out;
}

// ---------- Fetch and save ----------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HEADERS = { accept: "application/json", "user-agent": "Ballotwise/1.0 (+https://ballotwise.xanom.co/midterms)" };

async function getJson(url: string, retryDelays: readonly number[] = []): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 429 && attempt < retryDelays.length) {
      // Wait as long as the server asks (Retry-After, in seconds), within reason.
      const asked = Number(res.headers.get("retry-after")) * 1000;
      await sleep(Math.min(Number.isFinite(asked) && asked > 0 ? asked : retryDelays[attempt], 20_000));
      continue;
    }
    if (!res.ok) {
      const u = new URL(url);
      throw new Error(`${u.hostname}${u.pathname} returned ${res.status} (retry-after ${res.headers.get("retry-after") ?? "none"}, ${url.length} chars)`);
    }
    return res.json();
  }
}

async function fetchKalshi(races: readonly RaceSummary[], independents: ReadonlySet<string>): Promise<Book> {
  const house = ((await getJson(`${KALSHI}?series_ticker=KXHOUSERACE&status=open&limit=1000`, KALSHI_RETRY_MS)) as { markets?: KalshiMarket[] }).markets ?? [];
  const covered = new Set([...parseKalshi(house).keys()]);
  const tickers = kalshiTickers(races, covered);
  const all = [...house];
  for (let i = 0; i < tickers.length; i += TICKERS_PER_CALL) {
    await sleep(KALSHI_GAP_MS);
    const batch = tickers.slice(i, i + TICKERS_PER_CALL).join(",");
    all.push(...(((await getJson(`${KALSHI}?tickers=${batch}&limit=1000`, KALSHI_RETRY_MS)) as { markets?: KalshiMarket[] }).markets ?? []));
  }
  return Object.fromEntries(parseKalshi(all, independents));
}

const POLY_PAGE = 100;
/** House events come about 3.5 MB per page of 100; this caps the pages read per refresh (about 900 events today). */
const POLY_HOUSE_MAX_PAGES = 12;

const pageOf = (p: unknown) => (Array.isArray(p) ? (p as PolyEvent[]) : []);

/** Senate and Governor in one page each, then House district pages one at a time, parsed as they arrive to keep memory low. */
async function fetchPolymarket(): Promise<Book> {
  const book: Book = {};
  // Senate and Governor pages and each House page are parsed separately; a race appears in only one of them.
  for (const tag of ["senate-midterms", "governor-midterms"]) Object.assign(book, Object.fromEntries(parsePolymarket(pageOf(await getJson(`${POLYMARKET}?closed=false&limit=${POLY_PAGE}&tag_slug=${tag}`)))));
  const house = new Map<string, Quote>();
  for (let page = 0; page < POLY_HOUSE_MAX_PAGES; page++) {
    const events = pageOf(await getJson(`${POLYMARKET}?closed=false&limit=${POLY_PAGE}&offset=${page * POLY_PAGE}&tag_slug=house-elections&order=id&ascending=true`));
    for (const [key, odds] of parsePolymarket(events)) if (!house.has(key)) house.set(key, odds);
    if (events.length < POLY_PAGE) break;
  }
  return { ...book, ...Object.fromEntries(house) };
}

type PollsResult = { averages: Record<string, Polls>; generic: (Generic & { trend: TrendPoint[] }) | null; detail: Record<string, RacePolls> };

/** Our own generic-ballot average, counted in full once it has enough recent polls, with the aggregators' median making up the rest. */
export function genericMargin(own: { margin: number; recent: number } | null, aggregate: { margin: number } | null): number | null {
  const ownWeight = own ? Math.min(1, own.recent / RECENT_FULL) : 0;
  return own && aggregate ? ownWeight * own.margin + (1 - ownWeight) * aggregate.margin : (own?.margin ?? aggregate?.margin ?? null);
}

async function fetchPolls(races: readonly RaceSummary[], now: number): Promise<PollsResult> {
  const types: [Office, string][] = [["senate", "us-senator"], ["governor", "governor"], ["house", "us-representative"]];
  const averages: Record<string, Polls> = {};
  const detail: Record<string, RacePolls> = {};
  const list = (p: unknown) => (Array.isArray(p) ? (p as VoteHubPoll[]) : []);
  for (const [office, type] of types) {
    const votehub = list(await getJson(`${VOTEHUB}?poll_type=${type}`));
    // Senate and governor races add the polls Wikipedia lists that VoteHub doesn't; without Wikipedia, VoteHub's alone.
    const wiki =
      office === "senate" || office === "governor"
        ? await fetchWikiPolls(office, races, HEADERS).catch((err) => {
            console.error("midterms Wikipedia polls failed:", err instanceof Error ? err.message : err);
            return [];
          })
        : [];
    for (const [key, polls] of officePolls(mergePolls(votehub, wiki), office, races, now)) {
      detail[key] = polls;
      if (polls.average) averages[key] = { margin: polls.average.margin, count: polls.average.count, latest: polls.average.latest, left: polls.left };
    }
  }
  const own = genericBallot(list(await getJson(`${VOTEHUB}?poll_type=generic-ballot`)), now);
  const aggregate = await fetchAggregates(HEADERS)
    .then((rows) => aggregateMedian(rows, now))
    .catch((err) => {
      console.error("midterms generic-ballot aggregates failed:", err instanceof Error ? err.message : err);
      return null;
    });
  const margin = genericMargin(own, aggregate);
  const generic = margin === null ? null : { margin: Math.round(margin * 10) / 10, count: own?.count ?? 0, own: own?.margin, recent: own?.recent ?? 0, aggregate, trend: own?.trend ?? [] };
  return { averages, generic, detail };
}

/** A fresh result, or the previous one while it's younger than `maxAge`, or nothing. */
async function freshOrKept<T extends { at: number }>(work: Promise<Omit<T, "at">> | null, previous: T | null, maxAge: number, now: number, name: string): Promise<T | null> {
  if (work) {
    try {
      return { ...(await work), at: now } as T;
    } catch (err) {
      console.error(`midterms ${name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return previous && now - previous.at < maxAge ? previous : null;
}

/**
 * Fetches markets (and polls, when due) and saves a new snapshot. A source that fails keeps its last good data
 * for a while, so one outage doesn't wipe ratings, and very old data is dropped rather than shown as current.
 */
let running: Promise<OddsSnapshot> | null = null;

export function refreshOdds(db: Db, races: readonly RaceSummary[], now: number): Promise<OddsSnapshot> {
  // One refresh at a time per isolate: the cron and a stale page load arriving together share it.
  running ??= rebuild(db, races, now).finally(() => {
    running = null;
  });
  return running;
}

async function rebuild(db: Db, races: readonly RaceSummary[], now: number): Promise<OddsSnapshot> {
  const previous = await readOdds(db, now);
  const independents = new Set(races.filter((r) => r.candidates.some((c) => /^independent/i.test(c.party))).map((r) => raceKey(r.office, r.state, r.district)));
  const pollsDue = !previous?.polls || now - previous.polls.at >= POLLS_EVERY_MS;
  const [kalshi, polymarket, polls] = await Promise.all([
    freshOrKept<{ at: number; book: Book }>(fetchKalshi(races, independents).then((book) => ({ book })), previous?.kalshi ?? null, MARKETS_MAX_AGE_MS, now, "Kalshi"),
    freshOrKept<{ at: number; book: Book }>(fetchPolymarket().then((book) => ({ book })), previous?.polymarket ?? null, MARKETS_MAX_AGE_MS, now, "Polymarket"),
    freshOrKept<{ at: number } & PollsResult>(pollsDue ? fetchPolls(races, now) : null, null, POLLS_MAX_AGE_MS, now, "VoteHub").then((fresh) => fresh ?? (previous?.polls && now - previous.polls.at < POLLS_MAX_AGE_MS ? previous.polls : null)),
  ]);

  // A snapshot saved before volumes were kept holds bare odds; those prices are left out rather than read as untraded.
  const quotes = (book: Book | undefined) => new Map(Object.entries(book ?? {}).filter(([, q]) => typeof q.odds === "object"));
  const markets = combineMarkets(quotes(kalshi?.book), quotes(polymarket?.book));
  const generic = polls?.generic?.margin ?? null;
  const signals: Record<string, Signal> = {};
  for (const r of races) {
    if (r.office === "measure") continue;
    const key = raceKey(r.office, r.state, r.district);
    const market = markets.get(key) ?? null;
    const p = polls?.averages[key] ?? null;
    // Once votes are counted the forecast stays at its last pre-election value; markets then trade on the count itself.
    const frozen = r.total > 0 ? (previous?.signals[key]?.forecast ?? null) : null;
    const forecast = frozen ?? raceForecast(r, market, p, generic);
    if (market || p || forecast) signals[key] = { market, polls: p, rating: ratingOf(forecast), forecast };
  }
  const forecasts = chamberEntries(races, (r) => signals[raceKey(r.office, r.state, r.district)]?.forecast ?? null);
  const snapshot: OddsSnapshot = {
    at: now,
    kalshi,
    polymarket,
    // Poll lists stay out of the snapshot every page view reads; they're saved under their own key below.
    polls: polls ? { at: polls.at, averages: polls.averages, generic: polls.generic ? { margin: polls.generic.margin, count: polls.generic.count, own: polls.generic.own, recent: polls.generic.recent, aggregate: polls.generic.aggregate ?? null } : null } : null,
    signals,
    chambers: chamberViews(forecasts),
  };
  // Only replaces an older snapshot: a slow run that started earlier can't overwrite a newer one.
  await db
    .prepare("INSERT INTO research_cache (key, data, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, created_at = excluded.created_at WHERE excluded.created_at >= research_cache.created_at")
    .bind(KEY, JSON.stringify(snapshot), now)
    .run();
  // Only a fresh poll fetch carries the per-race lists and the generic ballot's trend.
  const fresh = polls && "detail" in polls ? (polls as { at: number } & PollsResult) : null;
  if (fresh) await putCached(db, POLLS_KEY, fresh.detail, now);
  const history = await recordHistory(db, signals, now);
  const chamberHistory = await recordChamberHistory(db, snapshot.chambers!, now);
  if (fresh && !chamberHistory.backfilled) await backfill(db, races, fresh.detail, fresh.generic?.trend ?? [], now, history, chamberHistory);
  return snapshot;
}

/** Every race's forecast for the chamber simulations; a race between two candidates of one party goes to that party. */
export function chamberEntries(races: readonly RaceSummary[], forecastOf: (r: RaceSummary) => Pick<Forecast, "odds"> | null) {
  return races.flatMap((r) => {
    if (r.office === "measure") return [];
    const sides = new Set(r.candidates.map((c) => sideOf(c.party)).filter((s) => s === "D" || s === "R"));
    const odds = forecastOf(r)?.odds ?? (sides.size === 1 ? { [[...sides][0]!]: 1 } : null);
    const lean = leanOf(r);
    // The census division and lean bucket whose shared errors the race takes part in.
    const group = lean === null ? {} : { region: (divisions as Record<string, string>)[r.state], bucket: leanBucket(lean - PARAMS.national2024) };
    return odds ? [{ office: r.office, forecast: { odds }, ...group }] : [];
  });
}

/** Adds today's chamber odds and seats to the daily chamber history, replacing today's earlier point. */
async function recordChamberHistory(db: Db, chambers: Chambers, now: number): Promise<ChamberHistory> {
  const prev = (await getCached<ChamberHistory>(db, CHAMBER_HISTORY_KEY, now)) ?? { house: [], senate: [], governor: [] };
  const today = etDay(now);
  const point = (c: Chambers["house"]): ChamberPoint => [today, c.dControl, c.dSeats, c.rSeats];
  const add = (list: ChamberPoint[], c: Chambers["house"]) => [...list.filter((p) => p[0] !== today), point(c)];
  const next: ChamberHistory = { ...prev, house: add(prev.house, chambers.house), senate: add(prev.senate, chambers.senate), governor: add(prev.governor, chambers.governor) };
  await putCached(db, CHAMBER_HISTORY_KEY, next, now);
  return next;
}

const dayAfter = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** A race's polling average as it stood on `day`, from its daily trend and the polls that had finished by then. */
function pollsOn(p: RacePolls | undefined, day: string): Polls | null {
  const point = p?.trend.find((t) => t[0] === Date.parse(`${day}T12:00:00Z`) / 1000);
  if (!p || !point) return null;
  const counted = p.rows.filter((r) => !r.excluded && r.end && r.end <= day);
  return counted.length >= 2 ? { margin: Math.round((point[1] - point[2]) * 10) / 10, count: counted.length, latest: counted[0].end, left: p.left } : null;
}

/**
 * Recomputes the daily race and chamber history back to BACKFILL_FROM, once, from what was known on each day: polls
 * that had finished and the generic ballot as of that day. Past market prices aren't stored, so those days have
 * none; the history marks them. Runs with fewer simulations per day to stay within the scheduled job's time.
 */
async function backfill(db: Db, races: readonly RaceSummary[], detail: Record<string, RacePolls>, genericTrend: TrendPoint[], now: number, history: ForecastHistory, chambers: ChamberHistory): Promise<void> {
  const firstKnown = [history.days[0], chambers.house[0]?.[0]].filter(Boolean).sort()[0] ?? etDay(now);
  const days: string[] = [];
  for (let d = BACKFILL_FROM; d < firstKnown; d = dayAfter(d)) days.push(d);
  if (!days.length) return;
  const gb = new Map(genericTrend.map((t) => [new Date(t[0] * 1000).toISOString().slice(0, 10), Math.round((t[1] - t[2]) * 10) / 10]));
  const raceP: Record<string, { side: Side; p: (number | null)[] }> = {};
  const points: Record<"house" | "senate" | "governor", ChamberPoint[]> = { house: [], senate: [], governor: [] };
  days.forEach((day, i) => {
    const forecasts = new Map<RaceSummary, Forecast | null>();
    for (const r of races) {
      if (r.office === "measure") continue;
      const key = raceKey(r.office, r.state, r.district);
      const f = raceForecast(r, null, pollsOn(detail[key], day), gb.get(day) ?? null);
      forecasts.set(r, f);
      if (!f) continue;
      const line = (raceP[key] ??= { side: f.left, p: Array<number | null>(days.length).fill(null) });
      if (line.side === f.left) line.p[i] = f.odds[f.left] ?? null;
    }
    const views = chamberViews(chamberEntries(races, (r) => forecasts.get(r) ?? null), 1000);
    for (const b of ["house", "senate", "governor"] as const) points[b].push([day, views[b].dControl, views[b].dSeats, views[b].rSeats]);
  });
  const races2: ForecastHistory["races"] = {};
  for (const key of new Set([...Object.keys(raceP), ...Object.keys(history.races)])) {
    const old = history.races[key];
    const back = raceP[key];
    const side = old?.side ?? back!.side;
    const before = back && back.side === side ? back.p : Array<number | null>(days.length).fill(null);
    races2[key] = { side, p: [...before, ...(old?.p ?? Array<number | null>(history.days.length).fill(null))] };
  }
  await putCached(db, HISTORY_KEY, { days: [...days, ...history.days], races: races2 }, now);
  await putCached(db, CHAMBER_HISTORY_KEY, {
    house: [...points.house, ...chambers.house],
    senate: [...points.senate, ...chambers.senate],
    governor: [...points.governor, ...chambers.governor],
    backfilled: { from: days[0], to: days.at(-1)!, markets: "none" },
  } satisfies ChamberHistory, now);
}

/** The day in Eastern time, which is when races are decided. */
const etDay = (now: number) => new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Adds today's forecast to each race's daily history, replacing today's earlier point. */
async function recordHistory(db: Db, signals: Record<string, Signal>, now: number): Promise<ForecastHistory> {
  const history = (await getCached<ForecastHistory>(db, HISTORY_KEY, now)) ?? { days: [], races: {} };
  const today = etDay(now);
  const days = history.days.at(-1) === today ? history.days : [...history.days, today];
  const at = days.length - 1;
  const races: ForecastHistory["races"] = {};
  for (const [key, signal] of Object.entries(signals)) {
    const f = signal.forecast;
    if (!f) continue;
    const prev = history.races[key];
    const p = [...(prev && prev.side === f.left ? prev.p : []), ...Array<number | null>(days.length).fill(null)].slice(0, days.length);
    p[at] = f.odds[f.left] ?? null;
    races[key] = { side: f.left, p };
  }
  await putCached(db, HISTORY_KEY, { days, races }, now);
  return { days, races };
}

/** When the ratings' evidence was last fetched: the newest market prices, or the polls when no market answered. */
export function evidenceAt(snapshot: OddsSnapshot | null): number | null {
  if (!snapshot) return null;
  const markets = Math.max(snapshot.kalshi?.at ?? 0, snapshot.polymarket?.at ?? 0);
  return markets || snapshot.polls?.at || null;
}

export function readOdds(db: Db, now: number): Promise<OddsSnapshot | null> {
  return getCached<OddsSnapshot>(db, KEY, now);
}

/** The snapshot's ratings in the form the race catalog attaches to races. */
export function ratedRaces(snapshot: OddsSnapshot | null): RatedRace[] {
  if (!snapshot) return [];
  return Object.entries(snapshot.signals).flatMap(([key, s]) => {
    if (!s.rating) return [];
    const [office, state, district] = key.split(":");
    return [{ office: office as Office, state, district: district === "" ? null : Number(district), rating: s.rating }];
  });
}
