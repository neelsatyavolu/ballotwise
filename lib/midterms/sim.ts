// Development only: a made-up election night for previewing the tracker before real votes exist.
// Loaded with a dynamic import behind a NODE_ENV check, so it never ships to production.
import { holderOf } from "./holders";
import { stateCloses, stateFinal } from "./polls";
import { balance, type RaceSummary } from "./races";
import type { Overview } from "./view";

const HOUR = 3_600_000;

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

function simulateRace(r: RaceSummary, at: number): RaceSummary {
  const close = stateCloses(r.state);
  if (close === null || at < close) return r;
  const hours = (at - close) / HOUR;
  const reporting = Math.min(99, Math.round(100 * (1 - Math.exp(-hours / (1.2 + rand(r.id, 4) * 1.5)))));
  if (reporting <= 0) return r;
  const final = finalMargin(r);
  // Early counts wander from the final result and settle as more is counted.
  const margin = final + (rand(r.id, 5) - 0.5) * 16 * (1 - reporting / 100);
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
  const lead = Math.abs(margin);
  const callable = at >= (stateFinal(r.state) ?? close) && (reporting >= 97 || (lead > 12 && reporting > 15) || (lead > 6 && reporting > 60) || (lead > 2.5 && reporting > 88));
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
    call: callable ? { id: r.id, at: Math.max(stateFinal(r.state) ?? close, at - rand(r.id, 7) * Math.min(at - close, 1.5 * HOUR)), winner: counted[0].name, replaced: null, withdrawn: false } : null,
  };
}

/** The overview as it might look at `at`, with seat counts to match. */
export function simulateOverview(data: Overview, at: number): Overview {
  const races = data.races.map((r) => simulateRace(r, at));
  const callEvents = races
    .filter((r) => r.call)
    .map((r) => ({ id: r.call!.id, raceId: r.id, office: r.office, kind: "call" as const, winner: r.call!.winner, party: r.candidates.find((c) => c.winner)?.party ?? null, previous: null, at: r.call!.at }))
    .sort((a, b) => b.at - a.at);
  const callEventCounts = { senate: 0, house: 0, governor: 0, measure: 0 };
  for (const e of callEvents) callEventCounts[e.office] += 1;
  return { ...data, races, balance: balance(races), fetchedAt: at, callEvents, callEventCounts };
}
