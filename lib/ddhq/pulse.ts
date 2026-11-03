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
/** `races` is keyed by seats.ts raceKey. `at` is when DDHQ's pages were read; null when they never were. */
export type Pulse = { at: number | null; chambers: Partial<Record<"senate" | "house", PulseChamber>>; races: Record<string, PulseRace> };

export const NO_PULSE: Pulse = { at: null, chambers: {}, races: {} };

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

/** The chamber's "Win Probability" chart: DDHQ Pulse's chance of control for each party. */
function chamberOf(text: string): PulseChamber | undefined {
  const m = /"title":"Win Probability"[^{}]*?"rep":(\d+(?:\.\d+)?),"dem":(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return undefined;
  const parsed = z.object({ rep: chance, dem: chance }).safeParse({ rep: Number(m[1]), dem: Number(m[2]) });
  return parsed.success ? parsed.data : undefined;
}

/** What one office's balance-of-power page says of Pulse. */
export function readPulsePage(text: string, office: PulseOffice): Pick<Pulse, "chambers" | "races"> {
  const races: Record<string, PulseRace> = {};
  for (const record of raceRecords(text)) {
    const parsed = raceRecord.safeParse(record);
    if (!parsed.success || !parsed.data.pulse) continue;
    const { stateAbb, district, pulse } = parsed.data;
    const seat = office === "house" ? Number(district) || 0 : null;
    races[raceKey(office, stateAbb, seat)] = { name: pulse.lastName, side: sideOf(pulse.party.abbrev), chance: pulse.winProbability };
  }
  const chamber = office === "governor" ? undefined : chamberOf(text);
  return { chambers: chamber ? { [office]: chamber } : {}, races };
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
  return {
    at: Date.now(),
    chambers: Object.assign({}, ...read.map((r) => r.chambers)),
    races: Object.assign({}, ...read.map((r) => r.races)),
  };
}

/**
 * The latest Pulse, shared by every visitor: the cached read while it's under PULSE_FRESH_MS old, else a new one.
 * When DDHQ can't be reached the last read stands until PULSE_STALE_MS, then nothing is shown.
 */
export async function loadPulse(db: Db, now: number): Promise<Pulse> {
  const cached = await getCachedShared<Pulse>(db, CACHE_KEY, now).catch(() => null);
  if (cached?.at && now - cached.at < PULSE_FRESH_MS) return cached;
  const fresh = await fetchPulse(AbortSignal.timeout(10_000)).catch((err) => {
    console.error("DDHQ Pulse failed:", err instanceof Error ? err.message : err);
    return null;
  });
  if (fresh) {
    await putCached(db, CACHE_KEY, fresh, now).catch((err) => console.error("DDHQ Pulse cache write failed:", err));
    return fresh;
  }
  return cached?.at && now - cached.at < PULSE_STALE_MS ? cached : NO_PULSE;
}
