import { balance, type Candidate, type CountyResult, type RaceDetail, type RaceSummary } from "../midterms/races";
import type { CallEvent, Overview } from "../midterms/view";
import type { DdhqCandidate, DdhqRace } from "./votes";
import { seatKey } from "./votes";

const marked = new WeakSet<object>();

export function isDesk(race: object): boolean {
  return marked.has(race);
}

function candidate(row: DdhqCandidate): Candidate {
  return { name: row.name, party: row.party, votes: row.votes, pct: row.pct, winner: row.winner, incumbent: row.incumbent };
}

/** Replace civicAPI's count and call with this user's Decision Desk HQ numbers. Forecast ratings are left as they are. */
export function applyDesk<T extends RaceSummary>(race: T, desk: DdhqRace): T {
  if (!desk.candidates) return race;
  const winner = desk.call?.name ?? desk.candidates.find((row) => row.winner)?.name ?? null;
  const candidates = desk.candidates.map((row) => candidate({ ...row, winner: row.name === winner }));
  const calledAt = desk.call ? Date.parse(desk.call.at) : Date.now();
  const next = {
    ...race,
    candidates,
    total: desk.total,
    calledFor: winner,
    callPending: undefined,
    call: winner ? { id: race.id, at: Number.isNaN(calledAt) ? Date.now() : calledAt, winner, replaced: null, withdrawn: false as const } : null,
  };
  if ("counties" in race && desk.counties.length > 0) {
    const detail = next as unknown as RaceDetail;
    detail.counties = (race as unknown as RaceDetail).counties.map((county) => mergeCounty(county, desk));
  }
  marked.add(next);
  return next;
}

function mergeCounty(county: CountyResult, desk: DdhqRace): CountyResult {
  const hit = desk.counties.find((row) => row.fips === county.fips);
  if (!hit) return county;
  const byName = new Map(hit.candidates.map((row) => [row.name, row]));
  const candidates = county.candidates.map((row) => {
    const next = byName.get(row.name);
    return next ? { ...row, votes: next.votes, pct: next.pct, party: next.party || row.party } : { ...row, votes: 0, pct: 0 };
  });
  for (const row of hit.candidates) {
    if (!candidates.some((candidate) => candidate.name === row.name)) candidates.push({ name: row.name, party: row.party, votes: row.votes, pct: row.pct });
  }
  return { ...county, total: candidates.reduce((sum, row) => sum + row.votes, 0), candidates };
}

export function deskKeyFor(race: Pick<RaceSummary, "office" | "state" | "district" | "title">): string {
  return seatKey({ office: race.office, state: race.state, district: race.district, special: /special/i.test(race.title) });
}

function eventsFor(races: readonly RaceSummary[]): CallEvent[] {
  return races
    .filter((race) => race.call && !race.call.withdrawn && race.call.winner)
    .map((race) => {
      const winner = race.candidates.find((candidate) => candidate.name === race.call!.winner);
      return { id: race.id, raceId: race.id, office: race.office, kind: "call" as const, winner: race.call!.winner, party: winner?.party ?? null, previous: null, at: race.call!.at };
    })
    .sort((a, b) => b.at - a.at);
}

/** Overlay one user's Decision Desk HQ counts onto a public civicAPI payload. The original object is not changed. */
export function overlayLive<T>(path: string | null, data: T, desk: ReadonlyMap<string, DdhqRace>): T {
  if (!path || desk.size === 0 || !data || typeof data !== "object") return data;
  if (path === "/api/midterms" && "races" in data) {
    const overview = data as unknown as Overview;
    let changed = false;
    const races = overview.races.map((race) => {
      if (race.office === "measure") return race;
      const hit = desk.get(deskKeyFor(race));
      if (!hit?.candidates) return race;
      changed = true;
      return applyDesk(race, hit);
    });
    if (!changed) return data;
    const callEvents = eventsFor(races);
    return { ...overview, races, balance: balance(races), callEvents, callEventCounts: undefined } as T;
  }
  if (/^\/api\/midterms\/race\/\d+$/.test(path) && "race" in data) {
    const body = data as { race: RaceDetail };
    if (body.race.office === "measure") return data;
    const hit = desk.get(deskKeyFor(body.race));
    if (!hit?.candidates) return data;
    return { ...body, race: applyDesk(body.race, hit) } as T;
  }
  return data;
}
