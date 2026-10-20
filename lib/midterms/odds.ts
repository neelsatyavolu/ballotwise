import type { Db } from "../auth/accounts";
import { getCached } from "../cache";
import type { Office, RaceSummary, RatedRace, Rating } from "./races";
import { partyOf, STATE_NAMES } from "./view";

// Race ratings computed live from prediction markets (Kalshi, Polymarket) and polls (VoteHub, CC BY 4.0).
// A scheduled job refreshes them every few minutes; pages read the saved result.

export type Side = "D" | "R" | "I";
export type Market = { odds: Partial<Record<Side, number>>; sources: ("Kalshi" | "Polymarket")[] };
export type Polls = { margin: number; count: number; latest: string };
export type Signal = { market: Market | null; polls: Polls | null; rating: Rating | null };
type Book = Record<string, Partial<Record<Side, number>>>;
/** Each source is kept with the time it was last fetched successfully, so one outage keeps the others' data. */
export type OddsSnapshot = {
  at: number;
  kalshi: { at: number; book: Book } | null;
  polymarket: { at: number; book: Book } | null;
  polls: { at: number; averages: Record<string, Polls> } | null;
  signals: Record<string, Signal>;
};

const KEY = "midterms:odds";
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
/** Polls older than this are left out of the average. */
const POLL_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const TICKERS_PER_CALL = 150;
/** Kalshi rate-limits bursts: requests are spaced out, and a 429 is retried after these waits. */
const KALSHI_GAP_MS = 400;
const KALSHI_RETRY_MS = [2000, 6000];

export const raceKey = (office: Office, state: string, district: number | null | undefined) => `${office}:${state}:${office === "house" ? (district ?? 0) : ""}`;
const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([postal, name]) => [name.toLowerCase(), postal]));

// ---------- Rating ----------

const level = (p: number) => (p < 0.6 ? "tossup" : p < 0.75 ? "lean" : p < 0.9 ? "likely" : null);
const levelFromMargin = (m: number) => (m < 3 ? "tossup" : m < 6 ? "lean" : m < 10 ? "likely" : null);

/**
 * Markets decide when they exist: the favorite's chance under 60% is a toss-up, under 75% leans, under 90% is likely,
 * and above that the race is safe (no rating). Without a market, the polling margin does the same at 3 / 6 / 10 points.
 */
export function rate(market: Market | null, polls: Polls | null): Rating | null {
  let side: Side;
  let tier: ReturnType<typeof level>;
  if (market && Object.keys(market.odds).length > 0) {
    const [best, p] = (Object.entries(market.odds) as [Side, number][]).sort((a, b) => b[1] - a[1])[0];
    side = best;
    tier = level(p);
  } else if (polls) {
    side = polls.margin >= 0 ? "D" : "R";
    tier = levelFromMargin(Math.abs(polls.margin));
  } else {
    return null;
  }
  if (!tier) return null;
  if (tier === "tossup") return "tossup";
  return `${tier}-${side.toLowerCase()}` as Rating;
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
 * Normalized win chances per race from Kalshi markets. When a race is listed twice, the busier market wins.
 * `independents` names races with an independent candidate Kalshi may not list (see normalize).
 */
export function parseKalshi(markets: readonly KalshiMarket[], independents: ReadonlySet<string> = new Set()): Map<string, Partial<Record<Side, number>>> {
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
  for (const { key, entries } of byEvent.values()) {
    const prev = best.get(key);
    const volume = (list: { volume: number }[]) => list.reduce((s, e) => s + e.volume, 0);
    if (!prev || volume(entries) > volume(prev)) best.set(key, entries);
  }
  return new Map([...best].map(([key, entries]) => [key, normalize(entries, independents.has(key))]));
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

function polySide(text: string): Side | null {
  const tag = text.match(/\((D|R|I)\)/);
  if (tag) return tag[1] as Side;
  if (/democrat/i.test(text)) return "D";
  if (/republican/i.test(text)) return "R";
  if (/independent/i.test(text)) return "I";
  return null;
}

/** The race a Polymarket winner event is about: "{State} Senate|Governor Election Winner" or "PA-07 House Election Winner". */
function polyRace(title: string | undefined): string | null {
  const t = title?.trim() ?? "";
  const statewide = t.match(/^(.+?) (Senate|Governor) Election Winner$/);
  if (statewide) {
    const state = STATE_BY_NAME.get(statewide[1].toLowerCase());
    return state ? raceKey(statewide[2] === "Senate" ? "senate" : "governor", state, null) : null;
  }
  const house = t.match(/^([A-Z]{2})-(\d+|AL) House Election Winner$/);
  return house ? raceKey("house", house[1], house[2] === "AL" ? 0 : Number(house[2])) : null;
}

/** Normalized win chances per race from Polymarket's winner events. When a race appears twice, the busier event wins. */
export function parsePolymarket(events: readonly PolyEvent[]): Map<string, Partial<Record<Side, number>>> {
  const best = new Map<string, { volume: number; odds: Partial<Record<Side, number>> }>();
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
  return new Map([...best].map(([key, v]) => [key, v.odds]));
}

/** Averages each race's chances across the markets that price it. */
export function combineMarkets(kalshi: Map<string, Partial<Record<Side, number>>>, poly: Map<string, Partial<Record<Side, number>>>): Map<string, Market> {
  const out = new Map<string, Market>();
  for (const key of new Set([...kalshi.keys(), ...poly.keys()])) {
    const found = [kalshi.has(key) && { src: "Kalshi" as const, odds: kalshi.get(key)! }, poly.has(key) && { src: "Polymarket" as const, odds: poly.get(key)! }].filter(
      (x): x is { src: "Kalshi" | "Polymarket"; odds: Partial<Record<Side, number>> } => !!x && Object.keys(x.odds).length > 0,
    );
    if (!found.length) continue;
    const odds: Partial<Record<Side, number>> = {};
    for (const side of ["D", "R", "I"] as Side[]) {
      const values = found.map((f) => f.odds[side] ?? 0);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      if (mean > 0) odds[side] = Math.round(mean * 1000) / 1000;
    }
    out.set(key, { odds, sources: found.map((f) => f.src) });
  }
  return out;
}

// ---------- Polls (VoteHub) ----------

type VoteHubPoll = { subject?: string; seat_name?: string | null; pollster?: string; end_date?: string; internal?: boolean; partisan?: string | null; answers?: { choice: string; pct: number }[] };

const lastName = (name: string) => name.toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b/g, " ").trim().split(/\s+/).at(-1) ?? "";

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
 * Polling margin (Democrat minus Republican, in points) per race: the newest nonpartisan poll from each pollster
 * in the last 45 days, averaged. Poll answers are matched to the race's candidates by last name.
 */
export function pollAverages(polls: readonly VoteHubPoll[], office: Office, races: readonly RaceSummary[], now: number): Map<string, Polls> {
  const byKey = new Map(races.filter((r) => r.office === office).map((r) => [raceKey(r.office, r.state, r.district), r]));
  const newest = new Map<string, Map<string, { margin: number; end: string }>>();
  for (const poll of polls) {
    if (poll.internal || poll.partisan || !poll.end_date) continue;
    const end = Date.parse(poll.end_date);
    if (!Number.isFinite(end) || end > now || now - end > POLL_WINDOW_MS) continue;
    const key = pollRace(poll, office);
    const race = key ? byKey.get(key) : undefined;
    if (!key || !race) continue;
    const sideOf = new Map(race.candidates.map((c) => [lastName(c.name), partyOf(c.party)]));
    let d = 0;
    let r = 0;
    for (const a of poll.answers ?? []) {
      const side = sideOf.get(lastName(a.choice));
      if (side === "D") d += a.pct;
      if (side === "R") r += a.pct;
    }
    if (!d || !r) continue;
    const pollster = poll.pollster ?? "unknown";
    const seen = newest.get(key) ?? new Map();
    const prev = seen.get(pollster);
    if (!prev || prev.end < poll.end_date) seen.set(pollster, { margin: d - r, end: poll.end_date });
    newest.set(key, seen);
  }
  const out = new Map<string, Polls>();
  for (const [key, byPollster] of newest) {
    const list = [...byPollster.values()].sort((a, b) => b.end.localeCompare(a.end)).slice(0, 8);
    const margin = list.reduce((s, p) => s + p.margin, 0) / list.length;
    out.set(key, { margin: Math.round(margin * 10) / 10, count: list.length, latest: list[0].end.slice(0, 10) });
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
  const house = new Map<string, Partial<Record<Side, number>>>();
  for (let page = 0; page < POLY_HOUSE_MAX_PAGES; page++) {
    const events = pageOf(await getJson(`${POLYMARKET}?closed=false&limit=${POLY_PAGE}&offset=${page * POLY_PAGE}&tag_slug=house-elections&order=id&ascending=true`));
    for (const [key, odds] of parsePolymarket(events)) if (!house.has(key)) house.set(key, odds);
    if (events.length < POLY_PAGE) break;
  }
  return { ...book, ...Object.fromEntries(house) };
}

async function fetchPolls(races: readonly RaceSummary[], now: number): Promise<Record<string, Polls>> {
  const types: [Office, string][] = [["senate", "us-senator"], ["governor", "governor"], ["house", "us-representative"]];
  const out: Record<string, Polls> = {};
  for (const [office, type] of types) {
    const polls = (await getJson(`${VOTEHUB}?poll_type=${type}`)) as VoteHubPoll[];
    for (const [key, avg] of pollAverages(Array.isArray(polls) ? polls : [], office, races, now)) out[key] = avg;
  }
  return out;
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
    freshOrKept<{ at: number; averages: Record<string, Polls> }>(pollsDue ? fetchPolls(races, now).then((averages) => ({ averages })) : null, previous?.polls ?? null, POLLS_MAX_AGE_MS, now, "VoteHub"),
  ]);

  const markets = combineMarkets(new Map(Object.entries(kalshi?.book ?? {})), new Map(Object.entries(polymarket?.book ?? {})));
  const signals: Record<string, Signal> = {};
  for (const r of races) {
    if (r.office === "measure") continue;
    const key = raceKey(r.office, r.state, r.district);
    const market = markets.get(key) ?? null;
    const p = polls?.averages[key] ?? null;
    if (market || p) signals[key] = { market, polls: p, rating: rate(market, p) };
  }
  const snapshot: OddsSnapshot = { at: now, kalshi, polymarket, polls, signals };
  // Only replaces an older snapshot: a slow run that started earlier can't overwrite a newer one.
  await db
    .prepare("INSERT INTO research_cache (key, data, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, created_at = excluded.created_at WHERE excluded.created_at >= research_cache.created_at")
    .bind(KEY, JSON.stringify(snapshot), now)
    .run();
  return snapshot;
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
