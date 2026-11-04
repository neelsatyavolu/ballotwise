import { AccountError, type Db } from "../auth/accounts";
import { getCached, putCached } from "../cache";
import { STATE_NAMES } from "../midterms/view";
import type { Office, Rating } from "../midterms/races";
import { chromeVotes } from "./chrome";
import { forgetVotesCookie, votesSessionCookie } from "./clerk";
import type { DdhqSession } from "./vault";
import { publishedRating } from "./rating";

const VOTES = "https://votes.decisiondeskhq.com";
const ELECTION = "2026-11-03";

const OFFICE_QUERY: Record<Exclude<Office, "measure">, { q: string; office: string }> = {
  senate: { q: "US Senate", office: "US Senate" },
  house: { q: "US House", office: "US House" },
  governor: { q: "Governor", office: "Governor" },
};

export type DdhqSide = "D" | "R" | "I";
export type DdhqForecast = { name: string; party: DdhqSide; probability: number };
export type DdhqCall = { name: string; at: string };
export type DdhqCandidate = { name: string; party: string; votes: number; pct: number; winner: boolean; incumbent: boolean; photo?: string };
/** `expected` is DDHQ's live estimate of the county's final vote; `done` is set once DDHQ says it's finished counting. */
export type DdhqCounty = { fips: string; name?: string; total?: number; reporting?: number; expected?: number; done?: true; candidates: { name: string; party: string; votes: number; pct: number }[] };
/** `candidates` is null when Votes didn't send a count, so the civicAPI numbers stay. */
/** `expected` is DDHQ's live estimate of the race's final vote, what its "% in" (`reporting`) is counted against. */
export type DdhqRace = { forecast: DdhqForecast[]; rating?: Rating | null; updatedAt?: number | null; resultsUpdatedAt?: string; reporting?: number; expected?: number; call: DdhqCall | null; candidates: DdhqCandidate[] | null; counties: DdhqCounty[]; total: number };
type DdhqResults = Pick<DdhqRace, "candidates" | "counties" | "total" | "reporting" | "expected" | "resultsUpdatedAt">;

export type DdhqSeat = { state: string; office: Exclude<Office, "measure">; district: number | null; special: boolean };

const ids = new Map<string, { id: string; at: number }>();
const ID_TTL = 6 * 60 * 60 * 1000;

/** D1's copy of the public seat-to-race-id mappings, shared by every isolate. */
const IDS_KEY = "ddhq:race-ids";
let idsLoaded = false;
/** The mappings changed (one learned, corrected or dropped) since D1's copy was last written. */
let idsChanged = false;

/** Sets a mapping, noting a change for saveRaceIds when the id is new. */
function setId(key: string, id: string): void {
  if (ids.get(key)?.id !== id) idsChanged = true;
  ids.set(key, { id, at: Date.now() });
}

function dropId(key: string): void {
  if (ids.delete(key)) idsChanged = true;
}

export function clearSeatCache(): void {
  ids.clear();
  idsLoaded = false;
  idsChanged = false;
}

/**
 * Adds the mappings other isolates saved, once per isolate, so a new one needn't relearn them from DDHQ's forecast
 * pages (a cold board pass otherwise fetches all three first). Only public race ids, never results.
 */
export async function loadRaceIds(db: Db): Promise<void> {
  if (idsLoaded) return;
  idsLoaded = true;
  try {
    const saved = await getCached<Record<string, string>>(db, IDS_KEY, Date.now());
    const at = Date.now();
    for (const [key, id] of Object.entries(saved ?? {})) if (!ids.has(key) && /^\d+$/.test(id)) ids.set(key, { id, at });
  } catch (err) {
    console.error("ddhq race ids read failed:", err instanceof Error ? err.message : err);
  }
}

/** Saves this isolate's mappings when any changed since the last save, corrections and drops included. Never throws. */
export async function saveRaceIds(db: Db): Promise<void> {
  if (!idsChanged) return;
  idsChanged = false;
  try {
    await putCached(db, IDS_KEY, Object.fromEntries([...ids].map(([key, { id }]) => [key, id])), Date.now());
  } catch (err) {
    idsChanged = true;
    console.error("ddhq race ids save failed:", err instanceof Error ? err.message : err);
  }
}

export function rememberRaceIds(rows: readonly { key: string; id: string }[]): void {
  for (const row of rows) setId(row.key, row.id);
}

export function seatKey(seat: { office: string; state: string; district: number | null; special?: boolean }): string {
  return `${seat.office}:${seat.state}:${seat.office === "house" ? (seat.district ?? 0) : ""}:${seat.special ? "s" : "g"}`;
}

type SearchHit = {
  source?: {
    race_id?: string | number;
    race_date?: string;
    office?: string;
    district?: string;
    election_type_name?: string;
  };
};

function sideOf(abbrev: string | undefined): DdhqSide {
  const code = (abbrev ?? "").toUpperCase();
  if (code === "D" || code === "DEM" || code === "DEMOCRATIC") return "D";
  if (code === "R" || code === "GOP" || code === "REP" || code === "REPUBLICAN") return "R";
  return "I";
}

/** A full name from its parts. Votes leaves stray spaces in some, like CA-16's lastName "Soulé ". */
function joinName(...parts: (string | undefined)[]): string {
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function personName(candidate: { firstName?: string; lastName?: string; name?: string } | undefined): string {
  if (!candidate) return "";
  return candidate.name?.trim() ? joinName(candidate.name) : joinName(candidate.firstName, candidate.lastName);
}

/** Votes' own headshot for a candidate, only from its image host; it sends null when it has none. */
function photoOf(image: unknown): string | undefined {
  return typeof image === "string" && /^https:\/\/data\.ddhq\.io\/[\w./-]+\.(?:png|jpe?g|webp)$/i.test(image) ? image : undefined;
}

function sameDistrict(office: Exclude<Office, "measure">, district: number | null, raw: string | undefined): boolean {
  if (office !== "house") return (raw ?? "") === "";
  const text = (raw ?? "").trim().toLowerCase();
  if (!district) return text === "" || text === "at-large" || text === "al" || text === "0";
  return text.replace(/^0+/, "") === String(district);
}

/** The November 2026 general (or special general) Decision Desk HQ lists for this seat. */
export function pickRace(results: SearchHit[], office: Exclude<Office, "measure">, district: number | null, special = false): string | null {
  const wanted = OFFICE_QUERY[office].office;
  const wantedType = special ? "Special Election General" : "General Election";
  const hit = results.find((row) => {
    const source = row.source;
    if (!source?.race_id) return false;
    if (source.race_date !== ELECTION || source.election_type_name !== wantedType) return false;
    if (source.office !== wanted) return false;
    return sameDistrict(office, district, source.district);
  });
  return hit?.source?.race_id == null ? null : String(hit.source.race_id);
}

function partyName(party: { name?: string; abbrev?: string } | undefined): string {
  if (party?.name) return party.name;
  const abbrev = (party?.abbrev ?? "").toUpperCase();
  if (abbrev === "D" || abbrev === "DEM") return "Democratic";
  if (abbrev === "R" || abbrev === "GOP" || abbrev === "REP") return "Republican";
  return party?.abbrev ?? "";
}

function pctOf(percent: unknown, votes: number, total: number): number {
  // DDHQ publishes percentage points, including small shares such as 0.3% and explicit zeroes.
  if (typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100) return percent;
  return total > 0 ? (votes / total) * 100 : 0;
}

function countOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function reportingOf(inCount: unknown, totalCount: unknown): number | undefined {
  const counted = countOf(inCount);
  const total = countOf(totalCount);
  return counted !== undefined && total && total > 0 ? Math.min(100, counted / total * 100) : undefined;
}

/** The most of the expected vote DDHQ shows as counted until a race is done, as its own "% in" does. */
const MAX_EXPECTED_IN = 99;

/**
 * DDHQ's "% in": votes counted over its live estimate of the race's final vote (turnout.estimated_votes_mid), as its
 * own pages show. Many states report no precinct counts to DDHQ, so precincts are only the fallback.
 */
export function expectedIn(total: number, estimate: unknown): number | undefined {
  const expected = countOf(estimate);
  return expected && expected > 0 ? Math.min(MAX_EXPECTED_IN, (total / expected) * 100) : undefined;
}

function timestampOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

export function readForecast(body: unknown): DdhqForecast[] {
  const parties = (body as { parties?: unknown }).parties;
  if (!Array.isArray(parties)) return [];
  const rows: DdhqForecast[] = [];
  for (const party of parties) {
    if (!party || typeof party !== "object") continue;
    const record = party as { abbrev?: string; shortAbbrev?: string; winProbability?: number; candidates?: { firstName?: string; lastName?: string; name?: string }[] };
    const probability = record.winProbability;
    const name = personName(record.candidates?.[0]);
    if (typeof probability !== "number" || !name) continue;
    rows.push({ name, party: sideOf(record.shortAbbrev ?? record.abbrev), probability });
  }
  return rows.sort((a, b) => b.probability - a.probability);
}

export function readResults(body: unknown): DdhqResults {
  const data = (body as { raceData?: { toplineResults?: unknown; countyResults?: unknown; totalVotes?: unknown; turnout?: { precincts_in?: unknown; precincts_tot?: unknown; estimated_votes_mid?: unknown }; lastUpdated?: unknown } } | null)?.raceData;
  const lines = data?.toplineResults;
  if (!Array.isArray(lines)) return { candidates: null, counties: [], total: 0 };
  const candidates: DdhqCandidate[] = [];
  const percents: unknown[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const record = line as { firstName?: string; lastName?: string; votes?: number; percent?: number; winner?: boolean; incumbent?: boolean; image?: unknown; party?: { name?: string; abbrev?: string } };
    const name = joinName(record.firstName, record.lastName);
    if (!name) continue;
    percents.push(record.percent);
    const photo = photoOf(record.image);
    candidates.push({
      name,
      party: partyName(record.party),
      votes: countOf(record.votes) ?? 0,
      pct: 0,
      winner: record.winner === true,
      incumbent: record.incumbent === true,
      ...(photo ? { photo } : {}),
    });
  }
  const total = countOf(data?.totalVotes) ?? candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
  for (let i = 0; i < candidates.length; i++) candidates[i] = { ...candidates[i], pct: pctOf(percents[i], candidates[i].votes, total) };
  candidates.sort((a, b) => b.votes - a.votes);
  const counties: DdhqCounty[] = [];
  const areas = data?.countyResults;
  if (Array.isArray(areas)) {
    for (const area of areas) {
      if (!area || typeof area !== "object") continue;
      const record = area as { fips?: string; county?: string; liveTurnoutEstimate?: { totalVotes?: unknown; precinctsIn?: unknown; precinctsTot?: unknown; estimatedVotesMid?: unknown; completedCounty?: unknown }; candidates?: { first_name?: string; last_name?: string; votes?: number; percent?: number; party?: { name?: string; abbrev?: string } }[] };
      if (!record.fips || !Array.isArray(record.candidates)) continue;
      const rows = record.candidates.flatMap((candidate) => {
        const name = joinName(candidate.first_name, candidate.last_name);
        if (!name) return [];
        const votes = countOf(candidate.votes) ?? 0;
        return [{ name, party: partyName(candidate.party), votes, percent: candidate.percent }];
      });
      const countyTotal = countOf(record.liveTurnoutEstimate?.totalVotes) ?? rows.reduce((sum, row) => sum + row.votes, 0);
      const expected = countOf(record.liveTurnoutEstimate?.estimatedVotesMid);
      const done = record.liveTurnoutEstimate?.completedCounty === true;
      // DDHQ's own "% Est.": the count over its expected vote, as for the race; precincts only where it has no estimate.
      const reporting = done ? 100 : expectedIn(countyTotal, expected) ?? reportingOf(record.liveTurnoutEstimate?.precinctsIn, record.liveTurnoutEstimate?.precinctsTot);
      counties.push({
        fips: record.fips,
        ...(typeof record.county === "string" ? { name: record.county } : {}),
        total: countyTotal,
        ...(reporting !== undefined ? { reporting } : {}),
        ...(expected && expected > 0 ? { expected } : {}),
        ...(done ? { done: true as const } : {}),
        candidates: rows.map(({ percent, ...row }) => ({ ...row, pct: pctOf(percent, row.votes, countyTotal) })).sort((a, b) => b.votes - a.votes),
      });
    }
  }
  const reporting = expectedIn(total, data?.turnout?.estimated_votes_mid) ?? reportingOf(data?.turnout?.precincts_in, data?.turnout?.precincts_tot);
  const expected = countOf(data?.turnout?.estimated_votes_mid);
  const resultsUpdatedAt = timestampOf(data?.lastUpdated);
  return { candidates, counties, total, ...(reporting !== undefined ? { reporting } : {}), ...(expected && expected > 0 ? { expected } : {}), ...(resultsUpdatedAt ? { resultsUpdatedAt } : {}) };
}

export function readCall(body: unknown): DdhqCall | null {
  const lines = (body as { raceData?: { toplineResults?: unknown } }).raceData?.toplineResults;
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const record = line as { winner?: boolean; called_at?: string | null; firstName?: string; lastName?: string };
    if (!record.winner) continue;
    const at = timestampOf(record.called_at);
    if (!at) continue;
    const name = joinName(record.firstName, record.lastName);
    if (name) return { name, at };
  }
  return null;
}

function challenged(res: Response): boolean {
  return res.status === 429 || res.headers.get("x-vercel-mitigated") === "challenge";
}

function checkActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AccountError("Decision Desk HQ's request timed out. Try again in a moment.", 502);
}

export async function votes(path: string, cookie: string, signal?: AbortSignal): Promise<Response> {
  checkActive(signal);
  const page = /^\/forecast\/2026\/(?:house|senate|governor)$/.test(path);
  const accept = page ? "text/x-component" : "application/json";
  // Prefer the proven warm egress instead of paying for a rejected Worker fetch per URL.
  const via = await chromeVotes(path, cookie, signal);
  checkActive(signal);
  const res = via ?? await fetch(`${VOTES}${path}`, {
    headers: { cookie, authorization: `Bearer ${cookie.slice("__session=".length)}`, accept, referer: `${VOTES}/`, ...(page ? { RSC: "1" } : {}) },
    cache: "no-store",
    redirect: "manual",
    signal,
  });
  checkActive(signal);
  // A refused token isn't reused: the next call mints a fresh one, and Clerk's answer then says if the session ended.
  if (res.status === 401) forgetVotesCookie(cookie);
  const redirected = res.status >= 300 && res.status < 400;
  const contentType = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const unexpected = res.ok ? contentType !== accept : res.status === 403 && contentType !== "application/json";
  if (challenged(res) || redirected || unexpected) throw new AccountError("Decision Desk HQ blocked this request. Try again in a minute.", 502);
  return res;
}

/** True when this session can open a Pro-only Votes feed. A free account gets 403. */
export async function votesIsPro(cookie: string): Promise<boolean> {
  const res = await votes("/api/vote-history?race_id=294677", cookie);
  const auth = res.headers.get("x-clerk-auth-status");
  if (res.status === 403 && (auth === "signed-out" || auth === "handshake")) {
    throw new AccountError("Decision Desk HQ couldn't verify this Votes session. Request a new code.", 502);
  }
  if (res.status === 403) return false;
  refused(res);
  if (res.status !== 200) throw new AccountError("Decision Desk HQ didn't confirm this account. Try connecting again.", 502);
  try {
    await res.json();
  } catch {
    throw new AccountError("Decision Desk HQ didn't confirm this account. Try connecting again.", 502);
  }
  return true;
}

/**
 * A 401 from a Votes feed, just after Clerk minted the token for it. Only Clerk's mint (clerk.ts) ends a connection: a
 * one-off 401 here must not disconnect an account mid-count, so it's a temporary failure the next poll retries.
 */
export const VOTES_REJECTED = "Decision Desk HQ didn't accept this request just now. It will try again shortly.";

function refused(res: Response): void {
  if (res.status === 401) throw new AccountError(VOTES_REJECTED, 502);
  if (res.status === 403) throw new AccountError("Decision Desk HQ refused this request for that account.", 403);
}

async function findRace(cookie: string, office: Exclude<Office, "measure">, state: string, district: number | null, special: boolean, signal?: AbortSignal): Promise<string | null> {
  checkActive(signal);
  const key = seatKey({ office, state, district, special });
  const cached = ids.get(key);
  if (cached && Date.now() - cached.at < ID_TTL) return cached.id;
  const stateName = STATE_NAMES[state];
  if (!stateName) return null;
  const query = OFFICE_QUERY[office];
  const params = new URLSearchParams({
    q: office === "house" ? `${query.q} ${district ? district : "At-Large"}` : query.q,
    filterYear: "2026",
    filterState: stateName,
    filterOffice: query.office,
  });
  const res = await votes(`/api/searchv2?${params}`, cookie, signal);
  refused(res);
  if (!res.ok) throw new AccountError("Decision Desk HQ's race search didn't answer.", 502);
  const body = (await res.json()) as { results?: SearchHit[] };
  checkActive(signal);
  const id = pickRace(body.results ?? [], office, district, special);
  if (id) setId(key, id);
  else dropId(key);
  return id;
}

async function loadRace(cookie: string, office: Exclude<Office, "measure">, state: string, district: number | null, special: boolean, counties: boolean, signal?: AbortSignal): Promise<DdhqRace | null> {
  const id = await findRace(cookie, office, state, district, special, signal);
  checkActive(signal);
  if (!id) return null;
  const [forecastRes, raceRes] = await Promise.all([votes(`/api/forecast/${id}`, cookie, signal), votes(`/api/races/${id}`, cookie, signal)]);
  checkActive(signal);
  refused(forecastRes);
  refused(raceRes);
  if (!forecastRes.ok && forecastRes.status !== 404) throw new AccountError("Decision Desk HQ didn't answer.", 502);
  if (!raceRes.ok && raceRes.status !== 404) throw new AccountError("Decision Desk HQ didn't answer.", 502);
  if (forecastRes.status === 404 && raceRes.status === 404) {
    const key = seatKey({ office, state, district, special });
    if (ids.get(key)?.id === id) dropId(key);
    return null;
  }
  const forecastBody = forecastRes.ok ? await forecastRes.json() as { rating?: unknown; updatedAt?: unknown } : null;
  checkActive(signal);
  const forecast = forecastBody ? readForecast(forecastBody) : [];
  const rating = publishedRating(forecastBody?.rating, forecast);
  const at = typeof forecastBody?.updatedAt === "string" ? Date.parse(forecastBody.updatedAt) : NaN;
  const raceBody = raceRes.ok ? await raceRes.json() : null;
  checkActive(signal);
  const call = raceBody ? readCall(raceBody) : null;
  const results: DdhqResults = raceBody ? readResults(raceBody) : { candidates: null, counties: [], total: 0 };
  if (forecast.length === 0 && !call && !results.candidates) return null;
  return { forecast, ...(rating !== undefined ? { rating } : {}), ...(Number.isFinite(at) ? { updatedAt: at } : {}), call, ...results, counties: counties ? results.counties : [] };
}

/** Forecast, count and call for one seat, fetched with this user's Votes session. */
export async function ddhqRace(session: DdhqSession, office: Exclude<Office, "measure">, state: string, district: number | null, special = false, signal?: AbortSignal): Promise<DdhqRace | null> {
  checkActive(signal);
  const cookie = await votesSessionCookie(session);
  const passSignal = AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]);
  return loadRace(cookie, office, state, district, special, true, passSignal);
}

async function withFourWorkers(count: number, run: (index: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  let stopped = false;
  async function worker() {
    while (!stopped) {
      const index = next++;
      if (index >= count) return;
      try {
        checkActive(signal);
        await run(index);
        checkActive(signal);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, count) }, () => worker()));
}

function temporary(error: unknown): boolean {
  return !(error instanceof AccountError) || error.status >= 500;
}

/** A cold full board can learn every needed public race ID from at most three fixed pages. */
async function primeRaceIds(cookie: string, seats: readonly DdhqSeat[], signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  const offices = [...new Set(seats.filter((seat) => {
    const cached = ids.get(seatKey(seat));
    return !cached || now - cached.at >= ID_TTL;
  }).map((seat) => seat.office))];
  if (!offices.length) return;
  const { readForecastPage } = await import("./forecast");
  await Promise.all(offices.map(async (office) => {
    try {
      const response = await votes(`/forecast/2026/${office}`, cookie, signal);
      refused(response);
      if (!response.ok) throw new AccountError("Decision Desk HQ's race metadata didn't answer.", 502);
      const page = readForecastPage(await response.text(), office);
      checkActive(signal);
      // Discard all forecasts/history; this existing cache retains only public seat keys and IDs.
      rememberRaceIds(page.races.map(({ key, id }) => ({ key, id })));
    } catch (error) {
      checkActive(signal);
      if (error instanceof AccountError && error.status === 401) throw error;
      // Counts do not depend on a forecast page being available: use the normal bounded search next.
    }
  }));
}

/** One authenticated board pass, with at most four upstream groups of 24 in flight. */
export async function ddhqSeats(session: DdhqSession, seats: DdhqSeat[], signal?: AbortSignal): Promise<{ key: string; race: DdhqRace | null }[]> {
  if (!seats.length) return [];
  checkActive(signal);
  const cookie = await votesSessionCookie(session);
  const passSignal = AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]);
  const fullBoard = seats.length > 24;
  if (fullBoard) await primeRaceIds(cookie, seats, passSignal);
  const resolved: (string | null)[] = new Array(seats.length);
  await withFourWorkers(seats.length, async (index) => {
    const seat = seats[index];
    try {
      resolved[index] = await findRace(cookie, seat.office, seat.state, seat.district, seat.special, passSignal);
    } catch (error) {
      checkActive(passSignal);
      if (!fullBoard || !temporary(error)) throw error;
      resolved[index] = null;
    }
  }, passSignal);
  const requested = [...new Set(resolved.filter((id): id is string => id !== null))];
  if (!requested.length) return seats.map((seat) => ({ key: seatKey(seat), race: null }));
  const groups: string[][] = [];
  for (let i = 0; i < requested.length; i += 24) groups.push(requested.slice(i, i + 24));
  const found = new Map<string, DdhqRace>();
  await withFourWorkers(groups.length, async (index) => {
    try {
      const response = await votes(`/api/races/batch/topline?ids=${groups[index].join(",")}`, cookie, passSignal);
      refused(response);
      if (!response.ok) throw new AccountError("Decision Desk HQ didn't answer.", 502);
      const body: unknown = await response.json();
      checkActive(passSignal);
      if (!Array.isArray(body)) throw new AccountError("Decision Desk HQ didn't return race results.", 502);
      const group = new Map<string, DdhqRace>();
      for (const row of body) {
        if (!row || typeof row !== "object" || !("id" in row)) continue;
        const results = readResults({ raceData: row });
        if (!results.candidates) continue;
        group.set(String(row.id), { forecast: [], call: readCall({ raceData: row }), ...results });
      }
      for (const [id, race] of group) found.set(id, race);
    } catch (error) {
      checkActive(passSignal);
      if (!fullBoard || !temporary(error)) throw error;
      // Only this failed group's rows become null, clearing its private overlay without hiding other races.
    }
  }, passSignal);
  return seats.map((seat, index) => ({ key: seatKey(seat), race: found.get(resolved[index] ?? "") ?? null }));
}
