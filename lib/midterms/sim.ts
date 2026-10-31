// A made-up election night for previewing the tracker before real votes exist: `?sim=` in development, or a mock night
// (see clock.ts). Loaded with a dynamic import only while a preview runs, so visitors never download it.
import type { CallEvent } from "./calls";
import { holderOf } from "./holders";
import { ELECTION_DAY_START, stateCloses, stateFinal } from "./polls";
import { balance, type CountyResult, type RaceDetail, type RaceSummary } from "./races";
import type { Overview } from "./view";

const HOUR = 3_600_000;
/** One race's call is withdrawn at 10 p.m. Eastern and made again at 11, so previews show both in the feed and on the map. */
const WITHDRAW_AT = ELECTION_DAY_START + 22 * HOUR;
const RECALL_AT = ELECTION_DAY_START + 23 * HOUR;

/** A repeatable random number in [0, 1) for a race and a salt. */
function rand(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The Democratic (or Yes) lead the count ends at, in points, from market odds when there are any. */
function finalMargin(r: RaceSummary): number {
  const odds = r.signal?.market?.odds;
  const noise = (rand(r.id, 1) - 0.5) * 8;
  if (r.office === "measure") return (rand(r.id, 2) - 0.4) * 40;
  if (odds && (odds.D !== undefined || odds.R !== undefined)) {
    const pD = odds.D ?? 1 - (odds.R ?? 0.5);
    return (pD - 0.5) * 36 + noise;
  }
  if (r.signal?.polls) return r.signal.polls.margin + noise;
  if (r.rating) return ({ tossup: 0, lean: 4, likely: 8 } as const)[r.rating === "tossup" ? "tossup" : r.rating.startsWith("lean") ? "lean" : "likely"] * (r.rating.endsWith("-r") ? -1 : 1) + noise;
  // Unrated seats are safe for whoever holds them.
  const holder = holderOf(r);
  return (15 + rand(r.id, 3) * 30) * (holder === "R" ? -1 : holder === "D" ? 1 : rand(r.id, 8) < 0.5 ? -1 : 1);
}

/** How much of a race is counted at `at`, hours after its polls `close`, and the Democratic (or Yes) lead then. */
function progress(r: RaceSummary, close: number, at: number): { reporting: number; margin: number } {
  const hours = (at - close) / HOUR;
  const reporting = Math.min(99, Math.round(100 * (1 - Math.exp(-hours / (1.2 + rand(r.id, 4) * 1.5)))));
  // Early counts wander from the final result and settle as more is counted.
  return { reporting, margin: finalMargin(r) + (rand(r.id, 5) - 0.5) * 16 * (1 - reporting / 100) };
}

function callableAt(r: RaceSummary, close: number, at: number): boolean {
  const { reporting, margin } = progress(r, close, at);
  const lead = Math.abs(margin);
  return at >= (stateFinal(r.state) ?? close) && (reporting >= 97 || (lead > 12 && reporting > 15) || (lead > 6 && reporting > 60) || (lead > 2.5 && reporting > 88));
}

const CALL_STEP = 5 * 60_000;

/**
 * When the race is first called, by `at`, or null if not yet: the first moment its count is callable, checked every
 * five minutes from a race-specific start. A call stays made, so its time never moves as the night goes on.
 */
function calledAt(r: RaceSummary, close: number, at: number): number | null {
  const from = (stateFinal(r.state) ?? close) + rand(r.id, 7) * CALL_STEP;
  for (let t = from; t <= at; t += CALL_STEP) if (callableAt(r, close, t)) return t;
  return null;
}

function simulateRace(r: RaceSummary, at: number): RaceSummary {
  const close = stateCloses(r.state);
  if (close === null || at < close) return r;
  const { reporting, margin } = progress(r, close, at);
  if (reporting <= 0) return r;
  const turnout = (r.office === "house" ? 320_000 : 2_600_000) * (0.5 + rand(r.id, 6) * 1.5);
  const total = Math.round((turnout * reporting) / 100);
  const yesSide = r.office === "measure";
  const first = r.candidates.find((c) => (yesSide ? /^yes$/i.test(c.name) : /^Democrat/i.test(c.party)));
  const second = r.candidates.find((c) => (yesSide ? /^no$/i.test(c.name) : /^Republican/i.test(c.party)));
  const minor = yesSide ? 0 : 0.02;
  const share = (name: string) => {
    if (first?.name === name) return (1 - minor) * (0.5 + margin / 200);
    if (second?.name === name) return (1 - minor) * (0.5 - margin / 200);
    return minor / Math.max(1, r.candidates.length - 2);
  };
  const callAt = calledAt(r, close, at);
  const callable = callAt !== null;
  const counted = r.candidates
    .map((c) => {
      const votes = first || second ? Math.round(total * share(c.name)) : Math.round(total / r.candidates.length);
      return { ...c, votes, pct: total ? Math.round((votes / total) * 10000) / 100 : 0, winner: false };
    })
    .sort((a, b) => b.votes - a.votes);
  if (callable && counted[0]) counted[0] = { ...counted[0], winner: true };
  return {
    ...r,
    reporting,
    total: counted.reduce((s, c) => s + c.votes, 0),
    candidates: counted,
    // A made-up last quarter hour: some votes added and the lead a little different.
    trend: callable ? null : { since: at - 15 * 60_000, baselineAt: at - 15 * 60_000, votesAdded: Math.round(total * 0.1 * (1 - reporting / 100)), prevMargin: Math.abs(margin + (rand(r.id, 9) - 0.5) * 3), prevLeader: null, lastChange: at - rand(r.id, 10) * 12 * 60_000 },
    calledFor: callable ? counted[0].name : null,
    call: callAt !== null ? { id: r.id, at: callAt, winner: counted[0].name, replaced: null, withdrawn: false } : null,
  };
}

/** The race whose call is withdrawn and made again: the first Senate race (by id) called before WITHDRAW_AT. */
function withdrawnRace(races: readonly RaceSummary[]): number | null {
  const called = races.filter((r) => r.office === "senate").map((r) => simulateRace(r, WITHDRAW_AT)).filter((r) => r.call && r.call.at < WITHDRAW_AT);
  return called.length ? Math.min(...called.map((r) => r.id)) : null;
}

type Event = Omit<CallEvent, "id">;

/** A race at `at` with its events, oldest first. The withdrawn race loses its call between WITHDRAW_AT and RECALL_AT. */
function raceWithEvents(r: RaceSummary, at: number, withdrawn: number | null): { race: RaceSummary; events: Event[] } {
  const race = simulateRace(r, at);
  const won = race.candidates.find((c) => c.winner);
  const call = (e: Pick<Event, "at" | "winner" | "previous">): Event => ({ raceId: r.id, office: r.office, kind: e.winner === null ? "withdrawal" : e.previous === null ? "call" : "change", party: e.winner === null ? null : (won?.party ?? null), ...e });
  if (r.id !== withdrawn || at < WITHDRAW_AT) return { race, events: race.call?.winner ? [call({ at: race.call.at, winner: race.call.winner, previous: null })] : [] };
  const first = simulateRace(r, WITHDRAW_AT).call!;
  const name = first.winner!;
  const events = [call({ at: first.at, winner: name, previous: null }), call({ at: WITHDRAW_AT, winner: null, previous: name })];
  if (at < RECALL_AT) {
    const shown = { ...race, candidates: race.candidates.map((c) => ({ ...c, winner: false })), calledFor: null };
    return { race: { ...shown, call: { id: 0, at: WITHDRAW_AT, winner: null, replaced: name, withdrawn: true } }, events };
  }
  const candidates = race.candidates.map((c) => ({ ...c, winner: c.name === name }));
  return { race: { ...race, candidates, calledFor: name, call: { id: 0, at: RECALL_AT, winner: name, replaced: null, withdrawn: false } }, events: [...events, call({ at: RECALL_AT, winner: name, previous: null })] };
}

/** The overview as it might look at `at`, with seat counts to match. Call events are numbered in the order they happened. */
export function simulateOverview(data: Overview, at: number): Overview {
  if (data.simulated) return data;
  const withdrawn = withdrawnRace(data.races);
  const results = data.races.map((r) => raceWithEvents(r, at, withdrawn));
  const ordered = results.flatMap((x) => x.events).sort((a, b) => a.at - b.at || a.raceId - b.raceId);
  const events: CallEvent[] = ordered.map((e, i) => ({ ...e, id: i + 1 }));
  const latestId = new Map(events.map((e) => [e.raceId, e.id]));
  const races = results.map(({ race }) => (race.call ? { ...race, call: { ...race.call, id: latestId.get(race.id) ?? 0 } } : race));
  const callEvents = [...events].reverse();
  const callEventCounts = { senate: 0, house: 0, governor: 0, measure: 0 };
  for (const e of callEvents) callEventCounts[e.office] += 1;
  return { ...data, races, balance: balance(races), fetchedAt: at, callEvents, callEventCounts, simulated: true };
}

/** A county's share of the race's votes: its 2024 presidential turnout where known, else an even split. */
function weights(counties: readonly CountyResult[]): number[] {
  const known = counties.map((c) => c.pres2024?.total ?? 0);
  const sum = known.reduce((a, b) => a + b, 0);
  return sum > 0 ? known.map((k) => k / sum) : counties.map(() => 1 / Math.max(1, counties.length));
}

/** One race page as it might look at `at`: the race simulated as in the overview, its counties counting around it. */
export function simulateDetail(race: RaceDetail, at: number): RaceDetail {
  const summary = simulateRace(race, at);
  if (summary === race) return race;
  const share = weights(race.counties);
  const counties = race.counties.map((c, i): CountyResult => {
    const seed = Number(c.fips ?? i);
    const reporting = Math.max(0, Math.min(100, Math.round(summary.reporting + (rand(seed, 11) - 0.5) * 40)));
    const total = Math.round(summary.total * share[i] * (reporting / Math.max(1, summary.reporting)));
    // Counties lean from the statewide count the way they did in 2024.
    const tilt = c.baseline2024 === null ? (rand(seed, 12) - 0.5) * 20 : c.baseline2024 / 2;
    const candidates = summary.candidates.map((x) => {
      const p = /^Democrat/i.test(x.party) ? x.pct + tilt : /^Republican/i.test(x.party) ? x.pct - tilt : x.pct;
      return { name: x.name, party: x.party, pct: Math.max(0, p), votes: 0 };
    });
    const sum = candidates.reduce((a, x) => a + x.pct, 0) || 1;
    const counted = candidates.map((x) => {
      const votes = Math.round((total * x.pct) / sum);
      return { ...x, votes, pct: total ? Math.round((votes / total) * 10000) / 100 : 0 };
    });
    return { ...c, reporting, total: counted.reduce((a, x) => a + x.votes, 0), candidates: counted.sort((a, b) => b.votes - a.votes) };
  });
  return { ...race, ...summary, counties };
}

/**
 * Any live answer as it might look at `at`: the overview, or a race page with its counties. Other answers (markets,
 * forecasts) pass through unchanged.
 */
export function simulatePayload<T>(path: string, data: T, at: number): T {
  const d = data as unknown as { races?: unknown; race?: unknown };
  if (path === "/api/midterms" && Array.isArray(d.races)) return simulateOverview(data as unknown as Overview, at) as unknown as T;
  if (/^\/api\/midterms\/race\/\d+$/.test(path) && d.race) {
    const race = simulateDetail(d.race as RaceDetail, at);
    return { ...data, race, callPending: false, fetchedAt: at } as T;
  }
  return data;
}
