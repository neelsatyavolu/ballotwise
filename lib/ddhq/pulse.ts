// DDHQ Pulse: Decision Desk HQ's live election-night model, from its public balance-of-power pages (no login). Each
// chamber's chance of control, and the chance in each Senate and governor race DDHQ models live (it has none per House
// race). The pages are React Server Component data, fetched through the Chrome-TLS egress like the early vote feed.
import { z } from "zod";
import type { Db } from "../auth/accounts";
import { getCachedShared, putCached } from "../cache";
import { appEnv } from "../env";
import { raceKey } from "../midterms/seats";

const VOTES = "https://votes.decisiondeskhq.com";
const OFFICES = ["senate", "house", "governor"] as const;
type PulseOffice = (typeof OFFICES)[number];

/** A side's chance of winning, in percent (DDHQ caps them at 99). */
export type PulseChamber = { dem: number; rep: number };
/** The candidate DDHQ's live model favors in one race, and their chance in percent. */
export type PulseRace = { name: string; side: "D" | "R" | "I"; chance: number };
export type PulseChamberName = "senate" | "house";
/** DDHQ's call of a chamber: the party projected to win control, and when it was called. */
export type PulseCall = { side: "D" | "R" | "I"; at: number };
/** One moment of each chamber's Pulse: the Democrats' chance of control in percent. A chamber read at another moment is left out. */
export type PulsePoint = { at: number } & Partial<Record<PulseChamberName, number>>;
/**
 * `races` is keyed by seats.ts raceKey. `at` is when DDHQ's pages were read; null when they never were. `history` is
 * the chambers' Pulse over the day, oldest first: DDHQ's own chart points and every read since. `calls` holds DDHQ's
 * call of each chamber it has called (missing from reads cached before calls were read).
 */
/** DDHQ's call of one race: the winner's name and party, and when it was called. */
export type PulseWinner = { name: string; side: "D" | "R" | "I"; at: number };
/**
 * `ids` maps each seat on the pages to DDHQ's race id, keyed as votes.ts seatKey keys seats ("house:AL:7:g"), so a
 * connected screen's DDHQ feed finds every race without searching for it.
 */
export type Pulse = { at: number | null; chambers: Partial<Record<PulseChamberName, PulseChamber>>; races: Record<string, PulseRace>; calls?: Partial<Record<PulseChamberName, PulseCall>>; winners?: Record<string, PulseWinner>; ids?: Record<string, number>; history: PulsePoint[] };

export const NO_PULSE: Pulse = { at: null, chambers: {}, races: {}, calls: {}, winners: {}, ids: {}, history: [] };
/** The most points kept: twelve hours of one-a-minute reads, the newest kept. */
const MAX_HISTORY = 720;

/** How long one read serves every visitor before DDHQ is asked again. */
export const PULSE_FRESH_MS = 60_000;
/** A read older than this is dropped rather than shown when DDHQ can't be reached. */
const PULSE_STALE_MS = 20 * 60_000;
const CACHE_KEY = "ddhq:pulse";

const HEADERS = {
  accept: "text/x-component",
  RSC: "1",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  referer: `${VOTES}/`,
};

const chance = z.number().min(0).max(100);
const raceRecord = z.object({
  stateAbb: z.string().regex(/^[A-Z]{2}$/),
  district: z.string().nullish(),
  pulse: z
    .object({ lastName: z.string().trim().min(1), party: z.object({ abbrev: z.string() }), winProbability: chance })
    .nullish(),
});

function sideOf(abbrev: string): PulseRace["side"] {
  const code = abbrev.toUpperCase();
  return code === "DEM" || code === "D" ? "D" : code === "GOP" || code === "REP" || code === "R" ? "R" : "I";
}

/** The JSON object that opens at `start` (a `{`), or null when the text ends first. */
function objectAt(text: string, start: number): string | null {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** The race records in a balance-of-power page, each `{"raceId":…}` object once. Records that don't parse are skipped. */
function raceRecords(text: string): unknown[] {
  const found = new Map<number, unknown>();
  for (let i = text.indexOf('{"raceId":'); i >= 0; i = text.indexOf('{"raceId":', i + 1)) {
    const json = objectAt(text, i);
    if (!json) break;
    try {
      const record = JSON.parse(json) as { raceId?: unknown };
      if (typeof record.raceId === "number") found.set(record.raceId, record);
    } catch {
      // A record cut by the stream's chunking: the same race appears again whole.
    }
  }
  return [...found.values()];
}

const chartPoints = z.array(z.object({ dt: z.number().int().positive(), democrats: chance }));

/** The chamber's "Win Probability" chart: DDHQ Pulse's chance of control for each party now, and its points so far. */
function chamberOf(text: string): { now: PulseChamber; points: { at: number; dem: number }[] } | undefined {
  const m = /"title":"Win Probability"[^{}]*?"rep":(\d+(?:\.\d+)?),"dem":(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return undefined;
  const parsed = z.object({ rep: chance, dem: chance }).safeParse({ rep: Number(m[1]), dem: Number(m[2]) });
  if (!parsed.success) return undefined;
  // The points follow the current numbers in the same chart; they hold no brackets of their own.
  const rest = /^[^{}]*?"points":(\[[^\]]*\])/.exec(text.slice(m.index + m[0].length));
  let points: { at: number; dem: number }[] = [];
  try {
    const read = rest ? chartPoints.safeParse(JSON.parse(rest[1])) : null;
    if (read?.success) points = read.data.map((p) => ({ at: p.dt, dem: p.democrats }));
  } catch {
    // Points cut short: the current numbers still stand.
  }
  return { now: parsed.data, points };
}

/**
 * `next` added to `history` in time order. A point that changes no chamber from the one before it is dropped (the
 * chart carries a value forward to the next change), and only the newest MAX_HISTORY are kept.
 */
export function mergeHistory(history: readonly PulsePoint[], next: readonly PulsePoint[]): PulsePoint[] {
  const byTime = new Map<number, PulsePoint>();
  for (const p of [...history, ...next]) byTime.set(p.at, { ...byTime.get(p.at), ...p });
  const last: Partial<Record<PulseChamberName, number>> = {};
  const kept: PulsePoint[] = [];
  for (const p of [...byTime.values()].sort((a, b) => a.at - b.at)) {
    const changed = (["senate", "house"] as const).filter((c) => p[c] !== undefined && p[c] !== last[c]);
    if (!changed.length) continue;
    const point: PulsePoint = { at: p.at };
    for (const c of changed) point[c] = last[c] = p[c];
    kept.push(point);
  }
  return kept.slice(-MAX_HISTORY);
}

/**
 * The chamber's call, from the page's balance block: `"winnerParty":{…"abbrev":"DEM"},"calledAt":"2026-11-04
 * 02:09:24.452689+00","totalSeats":435,"majorityNeeded":218` once DDHQ projects control (null for both before).
 */
function callOf(text: string): PulseCall | undefined {
  const m = /"winnerParty":\{[^{}]*?"abbrev":"([A-Z]+)"\},"calledAt":"(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(\.\d+)?\+00","totalSeats":\d+,"majorityNeeded":\d+/.exec(text);
  if (!m) return undefined;
  const at = Date.parse(`${m[2]}T${m[3]}${(m[4] ?? "").slice(0, 4)}Z`);
  return Number.isFinite(at) ? { side: sideOf(m[1]), at } : undefined;
}

const seatRecord = z.object({
  raceId: z.number().int().positive(),
  name: z.string().nullish(),
  stateAbb: z.string().regex(/^[A-Z]{2}$/),
  district: z.string().nullish(),
});
const winnerRecord = seatRecord.extend({
  results: z.object({
    candidates: z.array(z.object({ firstName: z.string().nullish(), lastName: z.string().nullish(), winner: z.boolean().nullish(), called_at: z.string().nullish(), party: z.object({ abbrev: z.string() }).nullish() })),
  }),
});

/** "2026-11-04 01:00:00.135809Z" or "…+00", as DDHQ times its calls; null when it isn't one. */
function callTime(value: string | null | undefined): number | null {
  const m = value?.match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(\.\d+)?(Z|\+00)$/);
  if (!m) return null;
  const at = Date.parse(`${m[1]}T${m[2]}${(m[3] ?? "").slice(0, 4)}Z`);
  return Number.isFinite(at) ? at : null;
}

/**
 * Every seat on the page: DDHQ's race id for each (`ids`, keyed as votes.ts seatKey: "house:AL:7:g", "senate:OH::s"),
 * and the winner and call time of each race DDHQ has called (`winners`, keyed by seats.ts raceKey). The page lists each
 * race's results with `"winner":true` and `called_at` on the called candidate.
 */
function seatsOf(text: string, office: PulseOffice): { winners: Record<string, PulseWinner>; ids: Record<string, number> } {
  const out: Record<string, PulseWinner> = {};
  const ids: Record<string, number> = {};
  for (let i = text.indexOf('{"raceId":'); i >= 0; i = text.indexOf('{"raceId":', i + 1)) {
    const json = objectAt(text, i);
    if (!json) break;
    let record: unknown;
    try {
      record = JSON.parse(json);
    } catch {
      continue;
    }
    const seat = seatRecord.safeParse(record);
    if (seat.success) {
      const district = office === "house" ? Number(seat.data.district) || 0 : "";
      ids[`${office}:${seat.data.stateAbb}:${district}:${/special/i.test(seat.data.name ?? "") ? "s" : "g"}`] = seat.data.raceId;
    }
    const parsed = winnerRecord.safeParse(record);
    if (!parsed.success) continue;
    const won = parsed.data.results.candidates.find((c) => c.winner);
    const at = callTime(won?.called_at);
    if (!won || at === null) continue;
    const house = office === "house" ? Number(parsed.data.district) || 0 : null;
    out[raceKey(office, parsed.data.stateAbb, house)] = { name: [won.firstName, won.lastName].filter(Boolean).join(" ").trim(), side: sideOf(won.party?.abbrev ?? ""), at };
  }
  return { winners: out, ids };
}

/** What one office's balance-of-power page says of Pulse. */
export function readPulsePage(text: string, office: PulseOffice): Pick<Pulse, "chambers" | "races" | "history"> & { calls: NonNullable<Pulse["calls"]>; winners: NonNullable<Pulse["winners"]>; ids: NonNullable<Pulse["ids"]> } {
  const races: Record<string, PulseRace> = {};
  for (const record of raceRecords(text)) {
    const parsed = raceRecord.safeParse(record);
    if (!parsed.success || !parsed.data.pulse) continue;
    const { stateAbb, district, pulse } = parsed.data;
    const seat = office === "house" ? Number(district) || 0 : null;
    races[raceKey(office, stateAbb, seat)] = { name: pulse.lastName, side: sideOf(pulse.party.abbrev), chance: pulse.winProbability };
  }
  const chamber = office === "governor" ? undefined : chamberOf(text);
  const call = office === "governor" ? undefined : callOf(text);
  const calls = call && office !== "governor" ? { [office]: call } : {};
  const { winners, ids } = seatsOf(text, office);
  if (!chamber || office === "governor") return { chambers: {}, races, calls, winners, ids, history: [] };
  return { chambers: { [office]: chamber.now }, races, calls, winners, ids, history: chamber.points.map((p) => ({ at: p.at, [office]: p.dem })) };
}

async function fetchPage(office: PulseOffice, signal: AbortSignal): Promise<string> {
  const url = `${VOTES}/balance-of-power/2026/${office}`;
  const egress = appEnv().DDHQ_EGRESS;
  const res = egress
    ? await egress.fetch(new Request(url, { redirect: "manual", signal }))
    : await fetch(url, { headers: HEADERS, redirect: "manual", signal });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("text/x-component")) {
    throw new Error(`HTTP ${res.status}${res.headers.get("x-vercel-mitigated") ? " (bot check)" : ""}`);
  }
  return res.text();
}

/** Reads all three pages now. Null when none could be read; an office that fails is left out. */
export async function fetchPulse(signal: AbortSignal): Promise<Pulse | null> {
  const pages = await Promise.allSettled(OFFICES.map(async (office) => readPulsePage(await fetchPage(office, signal), office)));
  const read = pages.flatMap((p, i) => {
    if (p.status === "fulfilled") return [p.value];
    console.error(`DDHQ Pulse ${OFFICES[i]} failed:`, p.reason instanceof Error ? p.reason.message : p.reason);
    return [];
  });
  if (!read.length) return null;
  const at = Date.now();
  const chambers: Pulse["chambers"] = Object.assign({}, ...read.map((r) => r.chambers));
  const now: PulsePoint = { at, ...(chambers.senate && { senate: chambers.senate.dem }), ...(chambers.house && { house: chambers.house.dem }) };
  return { at, chambers, races: Object.assign({}, ...read.map((r) => r.races)), calls: Object.assign({}, ...read.map((r) => r.calls)), winners: Object.assign({}, ...read.map((r) => r.winners)), ids: Object.assign({}, ...read.map((r) => r.ids)), history: mergeHistory(read.flatMap((r) => r.history), [now]) };
}

/** The last Pulse read while it's under PULSE_STALE_MS old, without asking DDHQ: for pages that mustn't wait on it. */
export async function cachedPulse(db: Db, now: number): Promise<Pulse | null> {
  const cached = await getCachedShared<Pulse>(db, CACHE_KEY, now).catch(() => null);
  return cached?.at && now - cached.at < PULSE_STALE_MS ? cached : null;
}

/**
 * The latest Pulse, shared by every visitor: the cached read while it's under PULSE_FRESH_MS old, else a new one.
 * When DDHQ can't be reached the last read stands until PULSE_STALE_MS, then nothing is shown.
 */
export async function loadPulse(db: Db, now: number): Promise<Pulse> {
  const cached = await getCachedShared<Pulse>(db, CACHE_KEY, now).catch(() => null);
  if (cached?.at && now - cached.at < PULSE_FRESH_MS) return { ...cached, history: cached.history ?? [] };
  const read = await fetchPulse(AbortSignal.timeout(10_000)).catch((err) => {
    console.error("DDHQ Pulse failed:", err instanceof Error ? err.message : err);
    return null;
  });
  if (read) {
    // Every read joins the day's line, so it fills in even if DDHQ's own chart points don't. Entries cached before
    // the line existed have none.
    // A chamber's call stands once made, so a page that failed this time keeps the call it had.
    const fresh: Pulse = { ...read, calls: { ...cached?.calls, ...read.calls }, winners: { ...cached?.winners, ...read.winners }, ids: { ...cached?.ids, ...read.ids }, history: mergeHistory(cached?.history ?? [], read.history) };
    await putCached(db, CACHE_KEY, fresh, now).catch((err) => console.error("DDHQ Pulse cache write failed:", err));
    return fresh;
  }
  return cached?.at && now - cached.at < PULSE_STALE_MS ? { ...cached, history: cached.history ?? [] } : NO_PULSE;
}
