import { AccountError } from "../auth/accounts";
import { STATE_NAMES } from "../midterms/view";
import type { Office, Rating } from "../midterms/races";
import { chromeVotes } from "./chrome";
import { votesSessionCookie } from "./clerk";
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
export type DdhqCandidate = { name: string; party: string; votes: number; pct: number; winner: boolean; incumbent: boolean };
export type DdhqCounty = { fips: string; candidates: { name: string; party: string; votes: number; pct: number }[] };
/** `candidates` is null when Votes didn't send a count, so the civicAPI numbers stay. */
export type DdhqRace = { forecast: DdhqForecast[]; rating?: Rating | null; updatedAt?: number | null; call: DdhqCall | null; candidates: DdhqCandidate[] | null; counties: DdhqCounty[]; total: number };

export type DdhqSeat = { state: string; office: Exclude<Office, "measure">; district: number | null; special: boolean };

const ids = new Map<string, { id: string | null; at: number }>();
const ID_TTL = 6 * 60 * 60 * 1000;

export function clearSeatCache(): void {
  ids.clear();
}

export function rememberRaceIds(rows: readonly { key: string; id: string }[]): void {
  for (const row of rows) ids.set(row.key, { id: row.id, at: Date.now() });
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

function personName(candidate: { firstName?: string; lastName?: string; name?: string } | undefined): string {
  if (!candidate) return "";
  if (candidate.name) return candidate.name;
  return [candidate.firstName, candidate.lastName].filter(Boolean).join(" ");
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
  if (typeof percent === "number" && percent > 0) return percent <= 1 ? percent * 100 : percent;
  return total > 0 ? (votes / total) * 100 : 0;
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

export function readResults(body: unknown): { candidates: DdhqCandidate[] | null; counties: DdhqCounty[]; total: number } {
  const lines = (body as { raceData?: { toplineResults?: unknown; countyResults?: unknown } }).raceData?.toplineResults;
  if (!Array.isArray(lines)) return { candidates: null, counties: [], total: 0 };
  const candidates: DdhqCandidate[] = [];
  const percents: unknown[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const record = line as { firstName?: string; lastName?: string; votes?: number; percent?: number; winner?: boolean; incumbent?: boolean; party?: { name?: string; abbrev?: string } };
    const name = [record.firstName, record.lastName].filter(Boolean).join(" ");
    if (!name) continue;
    percents.push(record.percent);
    candidates.push({
      name,
      party: partyName(record.party),
      votes: typeof record.votes === "number" ? record.votes : 0,
      pct: 0,
      winner: record.winner === true,
      incumbent: record.incumbent === true,
    });
  }
  const total = candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
  for (let i = 0; i < candidates.length; i++) candidates[i] = { ...candidates[i], pct: pctOf(percents[i], candidates[i].votes, total) };
  const counties: DdhqCounty[] = [];
  const areas = (body as { raceData?: { countyResults?: unknown } }).raceData?.countyResults;
  if (Array.isArray(areas)) {
    for (const area of areas) {
      if (!area || typeof area !== "object") continue;
      const record = area as { fips?: string; candidates?: { first_name?: string; last_name?: string; votes?: number; percent?: number; party?: { name?: string; abbrev?: string } }[] };
      if (!record.fips || !Array.isArray(record.candidates)) continue;
      const rows = record.candidates.flatMap((candidate) => {
        const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ");
        if (!name) return [];
        const votes = typeof candidate.votes === "number" ? candidate.votes : 0;
        return [{ name, party: partyName(candidate.party), votes, pct: pctOf(candidate.percent, votes, 0) }];
      });
      const countyTotal = rows.reduce((sum, row) => sum + row.votes, 0);
      counties.push({
        fips: record.fips,
        candidates: rows.map((row) => ({ ...row, pct: row.pct || pctOf(undefined, row.votes, countyTotal) })),
      });
    }
  }
  return { candidates, counties, total };
}

export function readCall(body: unknown): DdhqCall | null {
  const lines = (body as { raceData?: { toplineResults?: unknown } }).raceData?.toplineResults;
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const record = line as { winner?: boolean; called_at?: string | null; firstName?: string; lastName?: string };
    if (!record.winner || !record.called_at) continue;
    const name = [record.firstName, record.lastName].filter(Boolean).join(" ");
    if (name) return { name, at: record.called_at };
  }
  return null;
}

function challenged(res: Response): boolean {
  return res.status === 429 || res.headers.get("x-vercel-mitigated") === "challenge";
}

export async function votes(path: string, cookie: string): Promise<Response> {
  const page = /^\/forecast\/2026\/(?:house|senate|governor)$/.test(path);
  const accept = page ? "text/x-component" : "application/json";
  // Prefer the proven warm egress instead of paying for a rejected Worker fetch per URL.
  const res = await chromeVotes(path, cookie) ?? await fetch(`${VOTES}${path}`, {
    headers: { cookie, authorization: `Bearer ${cookie.slice("__session=".length)}`, accept, referer: `${VOTES}/`, ...(page ? { RSC: "1" } : {}) },
    cache: "no-store",
    redirect: "manual",
  });
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

function refused(res: Response): void {
  if (res.status === 401) throw new AccountError("The Votes sign-in expired. Connect it again.", 401);
  if (res.status === 403) throw new AccountError("Decision Desk HQ refused this request for that account.", 403);
}

async function findRace(cookie: string, office: Exclude<Office, "measure">, state: string, district: number | null, special: boolean): Promise<string | null> {
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
  const res = await votes(`/api/searchv2?${params}`, cookie);
  refused(res);
  if (!res.ok) throw new AccountError("Decision Desk HQ's race search didn't answer.", 502);
  const body = (await res.json()) as { results?: SearchHit[] };
  const id = pickRace(body.results ?? [], office, district, special);
  ids.set(key, { id, at: Date.now() });
  return id;
}

async function loadRace(cookie: string, office: Exclude<Office, "measure">, state: string, district: number | null, special: boolean, counties: boolean): Promise<DdhqRace | null> {
  const id = await findRace(cookie, office, state, district, special);
  if (!id) return null;
  const [forecastRes, raceRes] = await Promise.all([votes(`/api/forecast/${id}`, cookie), votes(`/api/races/${id}`, cookie)]);
  refused(forecastRes);
  refused(raceRes);
  if (!forecastRes.ok && forecastRes.status !== 404) throw new AccountError("Decision Desk HQ didn't answer.", 502);
  if (!raceRes.ok && raceRes.status !== 404) throw new AccountError("Decision Desk HQ didn't answer.", 502);
  if (forecastRes.status === 404 && raceRes.status === 404) return null;
  const forecastBody = forecastRes.ok ? await forecastRes.json() as { rating?: unknown; updatedAt?: unknown } : null;
  const forecast = forecastBody ? readForecast(forecastBody) : [];
  const rating = publishedRating(forecastBody?.rating, forecast);
  const at = typeof forecastBody?.updatedAt === "string" ? Date.parse(forecastBody.updatedAt) : NaN;
  const raceBody = raceRes.ok ? await raceRes.json() : null;
  const call = raceBody ? readCall(raceBody) : null;
  const results = raceBody ? readResults(raceBody) : { candidates: null, counties: [], total: 0 };
  if (forecast.length === 0 && !call && !results.candidates) return null;
  return { forecast, ...(rating !== undefined ? { rating } : {}), ...(Number.isFinite(at) ? { updatedAt: at } : {}), call, candidates: results.candidates, counties: counties ? results.counties : [], total: results.total };
}

/** Forecast, count and call for one seat, fetched with this user's Votes session. */
export async function ddhqRace(session: DdhqSession, office: Exclude<Office, "measure">, state: string, district: number | null, special = false): Promise<DdhqRace | null> {
  return loadRace(await votesSessionCookie(session), office, state, district, special, true);
}

/** Several seats at once. One session cookie covers the batch. Counties are left out so a board stays small. */
export async function ddhqSeats(session: DdhqSession, seats: DdhqSeat[]): Promise<{ key: string; race: DdhqRace | null }[]> {
  const cookie = await votesSessionCookie(session);
  const out: { key: string; race: DdhqRace | null }[] = new Array(seats.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= seats.length) return;
      const seat = seats[index];
      out[index] = { key: seatKey(seat), race: await loadRace(cookie, seat.office, seat.state, seat.district, seat.special, false) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, seats.length) }, () => worker()));
  return out;
}
