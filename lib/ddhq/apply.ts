import { balance, type Candidate, type CountyResult, type RaceDetail, type RaceSummary } from "../midterms/races";
import type { Forecast } from "../midterms/forecast";
import type { CallEvent, Overview } from "../midterms/view";
import type { DdhqCandidate, DdhqRace } from "./votes";
import { seatKey } from "./votes";
import type { DdhqForecastBundle } from "./forecast-types";

const marked = new WeakSet<object>();
const sources = new WeakMap<object, DdhqRace>();

export function isDesk(race: object): boolean {
  return marked.has(race);
}

/** The original private data for source-specific cards, without putting it in shared race caches. */
export function deskFor(race: object): DdhqRace | undefined {
  return sources.get(race);
}

function candidate(row: DdhqCandidate): Candidate {
  return { name: row.name, party: row.party, votes: row.votes, pct: row.pct, winner: row.winner, incumbent: row.incumbent };
}

function forecastOf(desk: DdhqRace): Forecast {
  const rows = [...desk.forecast].sort((a, b) => b.probability - a.probability);
  const left = rows.find((row) => row.party !== "R") ?? rows[0];
  const right = rows.find((row) => row.party === "R");
  return {
    source: "ddhq",
    updatedAt: desk.updatedAt ?? null,
    ratingKnown: desk.rating !== undefined,
    odds: Object.fromEntries(rows.map((row) => [row.party, row.probability])),
    left: left.party,
    names: left.party !== "R" && right ? { left: left.name, right: right.name } : null,
    margin: null,
    lean: null,
    incumbency: 0,
    fundamentals: null,
    environment: null,
    pollWeight: 0,
    pollMargin: null,
    marketWeight: 0,
    market: null,
  };
}

/** Replace each available DDHQ field independently; missing counts do not suppress a valid forecast. */
export function applyDesk<T extends RaceSummary>(race: T, desk: DdhqRace): T {
  if (!desk.candidates && !desk.forecast.length) return race;
  const published = sources.get(race);
  // The count endpoint may omit the category. Keep the published forecast as one coherent snapshot.
  const canonical = desk.rating === undefined && published?.rating !== undefined && published.forecast.length
    ? { ...desk, forecast: published.forecast, rating: published.rating, updatedAt: published.updatedAt }
    : desk;
  const next = { ...race };
  if (desk.candidates) {
    const winner = desk.call?.name ?? desk.candidates.find((row) => row.winner)?.name ?? null;
    const calledAt = desk.call ? Date.parse(desk.call.at) : NaN;
    next.candidates = desk.candidates.map((row) => candidate({ ...row, winner: row.name === winner })).sort((a, b) => b.votes - a.votes);
    next.total = desk.total;
    next.reporting = desk.reporting ?? 0;
    next.reportingUnknown = desk.total > 0 && desk.reporting === undefined ? true : undefined;
    next.calledFor = winner;
    next.callPending = undefined;
    next.callUnknown = undefined;
    next.missing = undefined;
    next.lastSeen = undefined;
    next.trend = undefined;
    next.round = undefined;
    next.call = winner && Number.isFinite(calledAt) ? { id: race.id, at: calledAt, winner, replaced: null, withdrawn: false } : null;
    if ("counties" in race) {
      const detail = next as unknown as RaceDetail;
      detail.counties = (race as unknown as RaceDetail).counties.map((county) => mergeCounty(county, desk));
      for (const county of desk.counties) {
        if (detail.counties.some((row) => row.fips === county.fips)) continue;
        detail.counties.push(mergeCounty({ fips: county.fips, name: county.name ?? county.fips, total: 0, reporting: 0, candidates: [], baseline2024: null, pres2024: null }, desk));
      }
      detail.updated = desk.resultsUpdatedAt ?? null;
    }
    marked.add(next);
  }
  if (canonical.forecast.length) {
    const rating = canonical.rating ?? null;
    next.rating = rating;
    next.signal = { rating, market: null, polls: null, forecast: forecastOf(canonical) };
    // Keep existing count rows intact while allowing forecast helpers to find DDHQ's actual nominees.
    const missing = canonical.forecast.filter((row) => !next.candidates.some((candidate) => candidate.name === row.name));
    if (missing.length) {
      const names = { D: "Democratic", R: "Republican", I: "Independent" };
      next.candidates = [...next.candidates, ...missing.map((row) => ({ name: row.name, party: names[row.party], votes: 0, pct: 0, winner: false, incumbent: false }))];
    }
  }
  sources.set(next, canonical);
  return next;
}

function mergeCounty(county: CountyResult, desk: DdhqRace): CountyResult {
  const hit = desk.counties.find((row) => row.fips === county.fips);
  if (!hit) return { ...county, total: 0, reporting: 0, reportingUnknown: true, candidates: [] };
  const candidates = hit.candidates.map((row) => ({ ...row }));
  const total = hit.total ?? candidates.reduce((sum, row) => sum + row.votes, 0);
  return { ...county, name: hit.name ?? county.name, total, candidates, reporting: hit.reporting ?? 0, reportingUnknown: total > 0 && hit.reporting === undefined ? true : undefined };
}

export function deskKeyFor(race: Pick<RaceSummary, "office" | "state" | "district" | "title">): string {
  return seatKey({ office: race.office, state: race.state, district: race.district, special: /special/i.test(race.title) });
}

function eventsFor(races: readonly RaceSummary[]): CallEvent[] {
  return races
    .filter((race) => race.call && !race.call.withdrawn && race.call.winner)
    .map((race) => {
      const winner = race.candidates.find((candidate) => candidate.name === race.call!.winner);
      const privateCall = isDesk(race);
      return { id: privateCall ? race.id : race.call!.id, raceId: race.id, office: race.office, kind: "call" as const, winner: race.call!.winner, party: winner?.party ?? null, previous: null, at: race.call!.at, ...(privateCall ? { source: "ddhq" as const } : {}) };
    })
    .sort((a, b) => b.at - a.at);
}

/** A loaded DDHQ bundle must not leave an unlisted race wearing the public model's projection. */
function withoutForecast<T extends RaceSummary>(race: T): T {
  if (race.rating === null && !race.signal) return race;
  const next = { ...race, rating: null, signal: null };
  if (marked.has(race)) marked.add(next);
  const source = sources.get(race);
  if (source) sources.set(next, source);
  return next;
}

/** Derive the private rendered view without modifying the public payload or its shared cache. */
export function overlayLive<T>(path: string | null, data: T, desk: ReadonlyMap<string, DdhqRace>, forecast?: DdhqForecastBundle["overview"] | null): T {
  if (path === "/api/midterms/forecast" && forecast) return forecast as T;
  if (!path || (!desk.size && !forecast) || !data || typeof data !== "object") return data;
  if (path === "/api/midterms" && "races" in data) {
    const overview = data as unknown as Overview;
    let changed = false;
    let countsChanged = false;
    const races = overview.races.map((race) => {
      if (race.office === "measure") return race;
      const hit = desk.get(deskKeyFor(race));
      let next = hit ? applyDesk(race, hit) : race;
      if (forecast && !hit?.forecast.length) next = withoutForecast(next);
      if (next !== race) changed = true;
      if (hit?.candidates) countsChanged = true;
      return next;
    });
    if (!changed && !forecast) return data;
    return {
      ...overview,
      races,
      ...(countsChanged ? { balance: balance(races), callEvents: eventsFor(races), callEventCounts: undefined } : {}),
      ...(forecast ? { forecastSource: "ddhq" as const, ratings: { updatedAt: forecast.updatedAt } } : {}),
    } as T;
  }
  if (/^\/api\/midterms\/race\/\d+$/.test(path) && "race" in data) {
    const body = data as { race: RaceDetail };
    if (body.race.office === "measure") return data;
    const hit = desk.get(deskKeyFor(body.race));
    let next = hit ? applyDesk(body.race, hit) : body.race;
    if (forecast && !hit?.forecast.length) next = withoutForecast(next);
    return next === body.race ? data : { ...body, race: next } as T;
  }
  return data;
}
