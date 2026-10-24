import { z } from "zod";
import { MEASURES } from "./data";
import type { Signal } from "./odds";
import { partyOf, STATE_NAMES } from "./view";

export const ELECTION_DATE = "2026-11-03";
/** The first polls open at 6 a.m. Eastern. civicAPI has shown test counts before then, so earlier numbers are ignored. */
export const FIRST_POLLS_OPEN = Date.parse("2026-11-03T11:00:00Z");

export type Office = "senate" | "house" | "governor" | "measure";
/** Lean and likely carry the favored side: d, r, or i (an independent, like Nebraska's Senate race). */
export type Rating = "tossup" | "lean-d" | "lean-r" | "lean-i" | "likely-d" | "likely-r" | "likely-i";
export type RatedRace = { office: Office; state: string; district?: number | null; rating: Rating; note?: string };

export type Candidate = { name: string; party: string; votes: number; pct: number; winner: boolean; incumbent: boolean };
export type RaceSummary = {
  id: number;
  office: Office;
  state: string;
  district: number | null;
  title: string;
  reporting: number;
  total: number;
  candidates: Candidate[];
  rating: Rating | null;
  /** Set when civicAPI has votes but no reporting figure, so `reporting` (0) shouldn't be shown as a share. */
  reportingUnknown?: true;
  /** civicAPI left this race out of its latest answer; the numbers are the last we saw. */
  missing?: true;
  /** When civicAPI last included this race; set on missing races. */
  lastSeen?: number;
  /** What a ballot measure does, with a link to its source when there is one. */
  about?: { text: string; url: string | null };
  /** Market odds and polling behind the rating, attached by the overview; absent on bare catalog entries. */
  signal?: Signal | null;
  /**
   * When our server first saw civicAPI's current call, since civicAPI gives no call time. `id` is the call event's
   * database id and `winner` the called candidate. `replaced` names the previous, different winner when the call
   * changed. A withdrawn call keeps its race here with `withdrawn: true`, `winner: null`, the time the withdrawal was
   * seen, and the withdrawn winner in `replaced`. Null when the race was never called.
   */
  call?:
    | { id: number; at: number; winner: string; replaced: string | null; withdrawn: false }
    | { id: number; at: number; winner: null; replaced: string; withdrawn: true }
    | null;
  /** Set when our recorded call disagrees with this race's current results, so `call` is held back (null) until they agree. */
  callPending?: true;
  /**
   * How the count moved over about the last 15 minutes, from our own observations. `baselineAt` (and `since`, the
   * same time) is the observation compared against: the race's numbers as of 15 minutes ago, or its oldest
   * observation when all are newer. `votesAdded` is this race's current total minus the baseline's, negative after a
   * correction. `lastChange` is when the votes last changed. Null when there's no baseline or nothing changed since it.
   */
  trend?: { since: number; baselineAt: number; votesAdded: number; prevMargin: number | null; prevLeader: string | null; lastChange: number } | null;
};
/** A county's 2024 presidential vote. */
export type Pres2024 = { harris: number; trump: number; total: number };
export type CountyResult = {
  fips: string | null;
  name: string;
  reporting: number;
  total: number;
  candidates: Omit<Candidate, "incumbent" | "winner">[];
  /** 2024 presidential margin, Harris minus Trump, in points. */
  baseline2024: number | null;
  pres2024: Pres2024 | null;
};
export type RaceDetail = RaceSummary & { pollsClose: string | null; updated: string | null; counties: CountyResult[] };

// civicAPI fields are loosely typed and sometimes missing, so every field falls back to a safe default.
const civicCandidate = z.object({
  name: z.string(),
  party: z.string().nullish(),
  votes: z.number().nullish(),
  winner: z.boolean().nullish(),
  incumbent: z.boolean().nullish(),
});
const civicRace = z.object({
  type: z.string().nullish(),
  election_type: z.string().nullish(),
  election_name: z.string(),
  election_date: z.string(),
  province: z.string().nullish(),
  district: z.string().nullish(),
  percent_reporting: z.number().nullish(),
  candidates: z.array(civicCandidate).default([]),
});
export type CivicRace = z.input<typeof civicRace> & { id?: number };
const civicDetail = civicRace.extend({
  polls_close: z.string().nullish(),
  last_updated: z.string().nullish(),
  region_results: z
    .record(z.string(), z.object({ name: z.string(), fips: z.string().nullish(), percent_reporting: z.number().nullish(), candidates: z.array(civicCandidate).default([]) }))
    .nullish(),
});

const MEASURE_TYPES = new Set(["Referendum", "Proposition", "Ballot Measure"]);

function officeOf(race: z.output<typeof civicRace>): Office | null {
  if (!race.election_date.startsWith(ELECTION_DATE) || /Primary|Runoff/i.test(race.election_name)) return null;
  if (race.type === "US Senate") return race.province && race.province !== "US" ? "senate" : null;
  if (race.type === "House of Representatives") return /US House/.test(race.election_name) ? "house" : null;
  // Territories (civicAPI lists Guam's governor) don't count toward the 50.
  if (race.type === "Governor") return race.election_type === "Statewide" && !!race.province && race.province !== "DC" && race.province in STATE_NAMES ? "governor" : null;
  if (race.type && MEASURE_TYPES.has(race.type)) return race.election_type === "Statewide" ? "measure" : null;
  return null;
}

/** "PA-05" → 5, "WY-AL" → 0 (at-large). */
function districtOf(code: string | null | undefined): number | null {
  const m = code?.match(/-(\d+|AL)$/);
  if (!m) return null;
  return m[1] === "AL" ? 0 : Number(m[1]);
}

/** Before votes arrive, list major-party candidates first, then independents, then others, then write-ins. */
function partyRank(party: string): number {
  if (partyOf(party) !== "other") return 0;
  if (/^independent/i.test(party)) return 1;
  return /write/i.test(party) ? 3 : 2;
}

function candidates(list: z.output<typeof civicCandidate>[]): Candidate[] {
  const total = list.reduce((sum, c) => sum + (c.votes ?? 0), 0);
  return list
    .map((c) => ({
      name: c.name.replace(/\s+/g, " ").trim(),
      party: c.party ?? "",
      votes: c.votes ?? 0,
      pct: total ? Math.round(((c.votes ?? 0) / total) * 10000) / 100 : 0,
      // civicAPI has flagged contested races as won before any votes were counted; trust a call only once
      // votes are in, or when the candidate is unopposed.
      winner: (c.winner ?? false) && (total > 0 || list.length === 1),
      incumbent: c.incumbent ?? false,
    }))
    .sort((a, b) => b.votes - a.votes || partyRank(a.party) - partyRank(b.party));
}

const ratingKey = (office: Office, state: string, district: number | null | undefined) => `${office}:${state}:${district ?? ""}`;

/** A Nov 3 general-election race for one of the tracked offices, or null for anything else. */
export function summarize(input: unknown, ratings: readonly RatedRace[]): RaceSummary | null {
  const parsed = civicRace.safeParse(input);
  if (!parsed.success) return null;
  const race = parsed.data;
  const office = officeOf(race);
  if (!office) return null;
  const state = race.province ?? "";
  const district = office === "house" ? districtOf(race.district) : null;
  const list = candidates(race.candidates);
  const key = ratingKey(office, state, district);
  return {
    id: (input as { id?: number }).id ?? 0,
    office,
    state,
    district,
    title: race.election_name,
    reporting: race.percent_reporting ?? 0,
    ...(race.percent_reporting == null && list.some((c) => c.votes > 0) && { reportingUnknown: true as const }),
    total: list.reduce((sum, c) => sum + c.votes, 0),
    candidates: list,
    rating: ratings.find((r) => ratingKey(r.office, r.state, r.district) === key)?.rating ?? null,
    ...(office === "measure" && { about: aboutMeasure(race.election_name) }),
  };
}

/** Ballotpedia's summary, or failing that the description civicAPI sometimes puts after " - " in the name. */
function aboutMeasure(name: string): RaceSummary["about"] {
  const known = MEASURES[name.trim()];
  if (known) return { text: known.summary, url: known.url };
  const [, tail] = name.split(" - ");
  return tail ? { text: tail.trim(), url: null } : undefined;
}

/**
 * One race with its county (or town) breakdown. The detail endpoint doesn't say which office a race is for,
 * so that comes from the race's catalog `summary`; votes come from the fresher detail.
 * `baseline` maps county FIPS to the 2024 presidential vote as [Harris, Trump, total].
 */
export function raceDetail(summary: RaceSummary, input: unknown, baseline: Readonly<Record<string, readonly [number, number, number]>>): RaceDetail {
  const race = civicDetail.parse(input);
  const list = candidates(race.candidates);
  const counties = Object.values(race.region_results ?? {}).map((region) => {
    const list = candidates(region.candidates);
    const pres = region.fips ? baseline[region.fips] : undefined;
    return {
      fips: region.fips ?? null,
      name: region.name,
      reporting: region.percent_reporting ?? 0,
      total: list.reduce((sum, c) => sum + c.votes, 0),
      candidates: list.map(({ name, party, votes, pct }) => ({ name, party, votes, pct })),
      baseline2024: pres ? Math.round(((pres[0] - pres[1]) / pres[2]) * 1000) / 10 : null,
      pres2024: pres ? { harris: pres[0], trump: pres[1], total: pres[2] } : null,
    };
  });
  return {
    ...summary,
    reporting: race.percent_reporting ?? summary.reporting,
    total: list.reduce((sum, c) => sum + c.votes, 0),
    candidates: list,
    pollsClose: race.polls_close ?? null,
    updated: race.last_updated ?? null,
    counties,
  };
}

export type Party = "D" | "R" | "other";

// Seats not on the ballot this year. Senate: 53 R – 47 D (with independents) going in; 22 R and 13 D seats
// are up (33 regular plus the Ohio and Florida specials). Governors: 14 states don't elect one in 2026.
const HOLDOVER = { senate: { D: 34, R: 31, other: 0 }, governor: { D: 6, R: 8, other: 0 } } as const;

export type Tally = { D: number; R: number; other: number; total: number; majority: number; uncalled: number };

/** Seats each party holds once called races are added to the seats not up this year. */
export function balance(races: readonly RaceSummary[]) {
  const tally = (office: Office, base: { D: number; R: number; other: number }, total: number, majority: number): Tally => {
    const won = { ...base };
    let uncalled = 0;
    for (const race of races) {
      if (race.office !== office) continue;
      const winner = race.candidates.find((c) => c.winner);
      if (winner) won[partyOf(winner.party)] += 1;
      else uncalled += 1;
    }
    return { ...won, total, majority, uncalled };
  };
  return {
    // The vice president breaks Senate ties, so Republicans control it at 50.
    senate: tally("senate", HOLDOVER.senate, 100, 51),
    house: tally("house", { D: 0, R: 0, other: 0 }, 435, 218),
    governor: tally("governor", HOLDOVER.governor, 50, 26),
  };
}

/** The race as it stood before any results: no votes, no calls. */
export function blankResults<T extends RaceSummary>(race: T): T {
  return { ...race, reporting: 0, total: 0, candidates: race.candidates.map((c) => ({ ...c, votes: 0, pct: 0, winner: false })) };
}

/** The races with each one's rating looked up afresh (null when unrated). */
export function applyRatings<T extends RaceSummary>(races: readonly T[], ratings: readonly RatedRace[]): T[] {
  const byKey = new Map(ratings.map((r) => [ratingKey(r.office, r.state, r.district), r.rating]));
  return races.map((r) => ({ ...r, rating: byKey.get(ratingKey(r.office, r.state, r.district)) ?? null }));
}
