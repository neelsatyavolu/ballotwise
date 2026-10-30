import type { Db } from "../auth/accounts";
import { getCached, putCached } from "../cache";
import { polyRace, polySide, raceKey, type Side } from "./odds";
import type { RaceSummary } from "./races";
import { partyOf, STATE_NAMES } from "./view";

// Price history behind one race's prediction markets, for the market panel: Polymarket's CLOB price history and
// Kalshi's candlesticks. Each source is fetched on its own, so one failing still leaves the other.

/** [unix seconds, chance from 0 to 1] */
export type Point = [number, number];
/** One outcome's price over the full life of the market (`all`, daily) and the last two days (`live`, hourly). */
export type Line = { name: string; side: Side | null; now: number; all: Point[]; live: Point[] };
/** `at` is when this source last answered. */
export type MarketBook = { question: string; url: string; lines: Line[]; at: number };
export type RaceMarkets = { at: number; polymarket: MarketBook | null; kalshi: MarketBook | null };

type Race = Pick<RaceSummary, "id" | "office" | "state" | "district" | "title" | "candidates">;
type Outcome = { name: string; side: Side | null; now: number; id: string };

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const HEADERS = { accept: "application/json", "user-agent": "Ballotwise/1.0 (+https://ballotwise.xanom.co/midterms)" };
/** Saved histories are reused this long before the markets are asked again. */
const FRESH_MS = 5 * 60 * 1000;
/** A source that fails keeps its last history this long, rather than vanishing from the panel. */
const KEEP_MS = 6 * 60 * 60 * 1000;
const LIVE_S = 48 * 60 * 60;
const DAY_MIN = 1440;
const HOUR_MIN = 60;
/** Outcomes drawn per market, most likely first; the rest are longshots that would only clutter the chart. */
const MAX_LINES = 6;
/** Points kept per line for the full history; the chart is a few hundred pixels wide. */
const MAX_POINTS = 180;
const TIMEOUT_MS = 12_000;
/** Kalshi limits bursts, so its requests go one at a time, and a 429 is tried again once after this wait. */
const KALSHI_RETRY_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string, retryAfter429 = 0): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 429 && retryAfter429) {
    await sleep(retryAfter429);
    return getJson(url);
  }
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`);
  return res.json();
}

/** At most `max` points, evenly spread, always keeping the first and the latest. */
export function thin(points: readonly Point[], max = MAX_POINTS): Point[] {
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

const round = (p: number) => Math.round(p * 1000) / 1000;
const pad = (d: number) => String(d).padStart(2, "0");
const seat = (race: Race) => `${race.state}-${race.district ? pad(race.district) : "AL"}`;

/** The panel's heading: "Who wins the Colorado Senate race?" or "Who wins the PA-07 House race?" */
export function question(race: Race): string {
  if (race.office === "house") return `Who wins the ${seat(race)} House race?`;
  return `Who wins the ${STATE_NAMES[race.state] ?? race.state} ${race.office === "senate" ? "Senate" : "governor's"} race?`;
}

/** The party of the race's candidate by this name, for market labels that give only a name ("Xavier Becerra"). */
function sideOfName(race: Race, name: string): Side | null {
  const last = (n: string) => n.toLowerCase().replace(/["“”][^"“”]*["“”]/g, " ").replace(/\b(jr|sr|ii|iii|iv)\.?$/, "").trim().split(/\s+/).at(-1) ?? "";
  const matches = race.candidates.filter((c) => last(c.name) === last(name));
  if (matches.length !== 1) return null;
  const p = partyOf(matches[0].party);
  return p === "other" ? "I" : p;
}

/** The candidate a party-only label ("Democrat", "Republican Party") stands for, when the race has exactly one. */
function byParty(race: Race, side: Side | null): string | null {
  if (!side) return null;
  const matches = race.candidates.filter((c) => {
    const p = partyOf(c.party);
    return (p === "other" ? "I" : p) === side;
  });
  return matches.length === 1 ? matches[0].name : null;
}

// ---------- Polymarket ----------

type PolyMarket = { groupItemTitle?: string; question?: string; outcomePrices?: string; clobTokenIds?: string; active?: boolean; closed?: boolean };
export type PolyEvent = { slug?: string; title?: string; markets?: PolyMarket[] };

const parseList = (s: string | undefined): string[] => {
  try {
    const v: unknown = JSON.parse(s ?? "");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/** The open outcomes of a Polymarket winner event, most likely first, each with the token its "Yes" trades as. */
export function polyOutcomes(event: PolyEvent, race: Race): Outcome[] {
  const out: Outcome[] = [];
  for (const m of event.markets ?? []) {
    if (m.active === false || m.closed) continue;
    const price = Number(parseList(m.outcomePrices)[0]);
    const token = parseList(m.clobTokenIds)[0];
    if (!token || !Number.isFinite(price)) continue;
    const label = (m.groupItemTitle ?? "").trim();
    const side = polySide(`${label} ${m.question ?? ""}`);
    // "John Hickenlooper (D)" names its candidate; "Democrat" names only a party.
    const named = label.replace(/\s*\((D|R|I)\)\s*$/, "").trim();
    const partyOnly = /^(democrat|republican|independent)/i.test(named);
    const name = (partyOnly ? byParty(race, side) : null) ?? named;
    out.push({ name, side: side ?? sideOfName(race, name), now: round(price), id: token });
  }
  return out.sort((a, b) => b.now - a.now);
}

/** Polymarket's `{ history: [{ t, p }] }` as points, oldest first. */
export function parsePolyHistory(body: unknown): Point[] {
  const history = (body as { history?: { t?: number; p?: number }[] } | null)?.history ?? [];
  return history.filter((h) => Number.isFinite(h.t) && Number.isFinite(h.p)).map((h): Point => [h.t!, round(h.p!)]);
}

async function polymarket(race: Race, now: number): Promise<MarketBook | null> {
  const key = raceKey(race.office, race.state, race.district);
  const title = race.office === "house" ? `${seat(race)} House Election Winner` : `${STATE_NAMES[race.state]} ${race.office === "senate" ? "Senate" : "Governor"} Election Winner`;
  const found = (await getJson(`${GAMMA}/public-search?q=${encodeURIComponent(title)}&limit_per_type=10&events_status=active`)) as { events?: PolyEvent[] };
  const event = (found.events ?? []).find((e) => polyRace(e.title) === key);
  if (!event) return null;
  const outcomes = polyOutcomes(event, race).slice(0, MAX_LINES);
  if (!outcomes.length) return null;
  const s = Math.floor(now / 1000);
  const lines = await Promise.all(
    outcomes.map(async (o): Promise<Line> => {
      const [all, live] = await Promise.all([
        getJson(`${CLOB}/prices-history?market=${o.id}&interval=max&fidelity=${DAY_MIN}`),
        getJson(`${CLOB}/prices-history?market=${o.id}&startTs=${s - LIVE_S}&endTs=${s}&fidelity=${HOUR_MIN}`),
      ]);
      return { name: o.name, side: o.side, now: o.now, all: thin(parsePolyHistory(all)), live: parsePolyHistory(live) };
    }),
  );
  return { question: question(race), url: `https://polymarket.com/event/${event.slug ?? ""}`, lines, at: now };
}

// ---------- Kalshi ----------

type Dollars = { close_dollars?: string; previous_dollars?: string };
export type KalshiCandle = { end_period_ts?: number; price?: Dollars; yes_bid?: Dollars; yes_ask?: Dollars };
export type KalshiMarket = { ticker: string; status?: string; yes_sub_title?: string; subtitle?: string; open_time?: string; last_price_dollars?: string; yes_bid_dollars?: string; yes_ask_dollars?: string; volume_fp?: string };

/** Every Kalshi event that could hold this race's winner market; ones that don't exist come back empty. */
export function kalshiEvents(race: Race): string[] {
  if (race.office === "senate") return [`SENATE${race.state}${/special/i.test(race.title) ? "S" : ""}-26`];
  if (race.office === "governor") return [`GOVPARTY${race.state}-26`, `KXGOVPARTY${race.state}-26`];
  const d = race.district ? pad(race.district) : "AL";
  const n = race.district ? String(race.district) : "AL";
  return [`KXHOUSERACE-${race.state}${d}-26`, `HOUSE${race.state}${n}-26`, `KXHOUSE${race.state}${n}-26`];
}

const num = (s: string | undefined) => (s === undefined || s === "" ? NaN : Number(s));

/** A market's price: the last trade, or the middle of a tight book. */
function kalshiNow(m: KalshiMarket): number {
  const last = num(m.last_price_dollars);
  if (last > 0) return last;
  const bid = num(m.yes_bid_dollars);
  const ask = num(m.yes_ask_dollars);
  return bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
}

/** The open outcomes of a Kalshi event, most likely first. Tickers end in the party (-D, -R) or a candidate code. */
export function kalshiOutcomes(markets: readonly KalshiMarket[], race: Race): Outcome[] {
  return markets
    .filter((m) => !m.status || m.status === "active" || m.status === "open")
    .map((m): Outcome => {
      const suffix = m.ticker.split("-").at(-1) ?? "";
      const side: Side | null = suffix === "D" || suffix === "R" || suffix === "I" ? suffix : /independent/i.test(m.subtitle ?? "") ? "I" : polySide(m.subtitle ?? "");
      return { name: m.yes_sub_title?.trim() || byParty(race, side) || suffix, side, now: round(kalshiNow(m)), id: m.ticker };
    })
    .sort((a, b) => b.now - a.now);
}

/** A candle's price: its last trade, else the middle of a tight book at its close, else the previous trade. */
function candlePrice(c: KalshiCandle): number | null {
  const close = num(c.price?.close_dollars);
  if (close >= 0) return close;
  const bid = num(c.yes_bid?.close_dollars);
  const ask = num(c.yes_ask?.close_dollars);
  if (bid >= 0 && ask > 0 && ask - bid <= 0.15) return (bid + ask) / 2;
  const prev = num(c.price?.previous_dollars);
  return prev >= 0 ? prev : null;
}

/** Kalshi's `{ candlesticks: [...] }` as points, oldest first; candles with no usable price are left out. */
export function parseKalshiCandles(body: unknown): Point[] {
  const candles = (body as { candlesticks?: KalshiCandle[] } | null)?.candlesticks ?? [];
  const out: Point[] = [];
  for (const c of candles) {
    const p = candlePrice(c);
    if (p !== null && Number.isFinite(c.end_period_ts)) out.push([c.end_period_ts!, round(p)]);
  }
  return out;
}

async function kalshi(race: Race, now: number): Promise<MarketBook | null> {
  // The busiest event wins when a race is listed under more than one series.
  const found: { event: string; markets: KalshiMarket[] }[] = [];
  for (const event of kalshiEvents(race)) found.push({ event, markets: ((await getJson(`${KALSHI}/markets?event_ticker=${event}&limit=50`, KALSHI_RETRY_MS)) as { markets?: KalshiMarket[] }).markets ?? [] });
  const volume = (ms: KalshiMarket[]) => ms.reduce((s, m) => s + (num(m.volume_fp) || 0), 0);
  const best = found.filter((f) => f.markets.length).sort((a, b) => volume(b.markets) - volume(a.markets))[0];
  if (!best) return null;
  const series = ((await getJson(`${KALSHI}/events/${best.event}`, KALSHI_RETRY_MS)) as { event?: { series_ticker?: string } }).event?.series_ticker;
  const outcomes = kalshiOutcomes(best.markets, race).slice(0, MAX_LINES);
  if (!series || !outcomes.length) return null;
  const s = Math.floor(now / 1000);
  const opened = Math.min(...best.markets.map((m) => Date.parse(m.open_time ?? "")).filter(Number.isFinite));
  const start = Number.isFinite(opened) ? Math.floor(opened / 1000) : s - 365 * 86400;
  const candles = (ticker: string, from: number, period: number) => getJson(`${KALSHI}/series/${series}/markets/${ticker}/candlesticks?start_ts=${from}&end_ts=${s}&period_interval=${period}`, KALSHI_RETRY_MS);
  const lines: Line[] = [];
  for (const o of outcomes) {
    const all = await candles(o.id, start, DAY_MIN);
    const live = await candles(o.id, s - LIVE_S, HOUR_MIN);
    lines.push({ name: o.name, side: o.side, now: o.now, all: thin(parseKalshiCandles(all)), live: parseKalshiCandles(live) });
  }
  return { question: question(race), url: `https://kalshi.com/markets/${series.toLowerCase()}`, lines, at: now };
}

// ---------- Saved per race ----------

const cacheKey = (id: number) => `midterms:markets:${id}`;

/** Both markets' histories for a race, from the saved copy while it's fresh, else fetched and saved again. */
export async function raceMarkets(db: Db, race: Race, now: number): Promise<RaceMarkets> {
  const saved = await getCached<RaceMarkets>(db, cacheKey(race.id), now);
  if (saved && now - saved.at < FRESH_MS) return saved;
  // A failed source keeps the history it last answered with, for a while.
  const keep = (name: "polymarket" | "kalshi") => {
    const old = saved?.[name];
    return old && now - old.at < KEEP_MS ? old : null;
  };
  const [poly, kal] = await Promise.allSettled([polymarket(race, now), kalshi(race, now)]);
  for (const [name, r] of [["Polymarket", poly], ["Kalshi", kal]] as const) if (r.status === "rejected") console.error(`midterms ${name} history failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
  const fresh: RaceMarkets = {
    at: now,
    polymarket: poly.status === "fulfilled" ? poly.value : keep("polymarket"),
    kalshi: kal.status === "fulfilled" ? kal.value : keep("kalshi"),
  };
  await putCached(db, cacheKey(race.id), fresh, now);
  return fresh;
}
