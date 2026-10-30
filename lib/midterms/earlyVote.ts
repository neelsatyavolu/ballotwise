// Early vote: ballots requested, returned by mail and cast in person before Election Day, from civicAPI's tracker
// (compiled from state election offices). Pure shaping only; earlyVoteSource.ts does the fetching.
import { z } from "zod";
import baseline from "./baseline2024.json";
import states from "./states.json";
import { STATE_NAMES } from "./view";

const tally = z.record(z.string(), z.object({ votes: z.number() }));
/** One civicAPI early vote answer: a state's counties (or the nation's states) for one kind of ballot. */
export const earlyFeed = z.object({ snapshot_date: z.string().nullish(), regions: z.record(z.string(), tally).default({}), statewide_total: tally.default({}) });
export type EarlyFeed = z.infer<typeof earlyFeed>;
type Tally = z.infer<typeof tally>;
export type Feeds = { returned: EarlyFeed; inperson: EarlyFeed; requested: EarlyFeed };

/** Ballots cast by registered party. `other` is everyone else: unaffiliated, independents and minor parties. */
export type PartySplit = { dem: number; rep: number; other: number };
/** `cast` is mail ballots returned plus in-person early votes; `requested` counts mail ballots sent or asked for. */
export type Counts = { requested: number; returned: number; inperson: number; cast: number; party: PartySplit | null };
export type EarlyState = Counts & { state: string; base2024: number | null };
export type EarlyCounty = Counts & { name: string; fips: string | null; base2024: number | null };
export type Breakdown = { label: string; votes: number }[];
export type Demographics = Partial<Record<"age" | "gender" | "race", Breakdown>>;
/**
 * An estimate of how the early ballots lean, for states that don't record party: each county's ballots counted at
 * that county's 2024 presidential margin (Democrat minus Republican, in points). `state2024` is the whole state's
 * 2024 margin to set it against; `coverage` is the share of ballots placed in a county.
 */
export type Lean = { margin: number; state2024: number; coverage: number };
/** The same day before the 2024 election, where civicAPI kept that year's counts. */
export type Prior = { date: string; returned: number; inperson: number; cast: number; party: PartySplit | null };

export type EarlyNation = { fetchedAt: number; asOf: string | null; states: EarlyState[] };
export type EarlyStateDetail = Counts & {
  fetchedAt: number;
  asOf: string | null;
  state: string;
  base2024: number | null;
  counties: EarlyCounty[];
  /** The state reports by town (New England), so its places aren't counties and the map can't show them. */
  byTown: boolean;
  prior: Prior | null;
  demographics: Demographics;
  lean: Lean | null;
};

/** A party split is shown only when the state records party for at least this share of its ballots. */
const PARTY_COVERAGE = 0.9;
/** The county estimate is made only when at least this share of ballots can be placed in a county. */
const LEAN_COVERAGE = 0.8;
const ELECTION_2026 = Date.UTC(2026, 10, 3);
const ELECTION_2024 = Date.UTC(2024, 10, 5);
const DAY_MS = 86_400_000;

const sum = (t: Tally | undefined) => Object.values(t ?? {}).reduce((n, v) => n + v.votes, 0);

/** Registration split of the ballots in `tallies` (mail and in-person together), or null when most have no party on file. */
export function partyOf(tallies: readonly (Tally | undefined)[]): PartySplit | null {
  let dem = 0;
  let rep = 0;
  let other = 0;
  let unknown = 0;
  for (const [party, { votes }] of tallies.flatMap((t) => Object.entries(t ?? {}))) {
    if (party === "Democratic") dem += votes;
    else if (party === "Republican") rep += votes;
    else if (party === "Unspecified") unknown += votes;
    else other += votes;
  }
  const known = dem + rep + other;
  return known > 0 && known >= (known + unknown) * PARTY_COVERAGE ? { dem, rep, other } : null;
}

function countsOf(feeds: Feeds, region: (feed: EarlyFeed) => Tally | undefined): Counts {
  const returned = sum(region(feeds.returned));
  const inperson = sum(region(feeds.inperson));
  return { requested: sum(region(feeds.requested)), returned, inperson, cast: returned + inperson, party: partyOf([region(feeds.returned), region(feeds.inperson)]) };
}

const stateFips: Record<string, string> = Object.fromEntries(states.map(([fips, postal]) => [postal, fips]));
const postalOf: Record<string, string> = Object.fromEntries(states.map(([fips, postal]) => [fips, postal]));
/** Each county's 2024 presidential vote as [Harris, Trump, total]. */
const votes2024: Record<string, number[]> = baseline;
/** Each state's 2024 presidential vote, summed from its counties, and its Democrat-minus-Republican lead in votes. */
const stateBase: Record<string, number> = {};
const stateLead: Record<string, number> = {};
for (const [fips, [dem, rep, total]] of Object.entries(votes2024)) {
  const postal = postalOf[fips.slice(0, 2)];
  if (!postal) continue;
  stateBase[postal] = (stateBase[postal] ?? 0) + total;
  stateLead[postal] = (stateLead[postal] ?? 0) + dem - rep;
}

/** How a state's early ballots lean if each county's voted the way the county did in 2024; null when too few can be placed. */
export function leanOf(state: string, counties: readonly EarlyCounty[]): Lean | null {
  let all = 0;
  let placed = 0;
  let weighted = 0;
  for (const c of counties) {
    all += c.cast;
    const v = c.fips ? votes2024[c.fips] : undefined;
    if (!v?.[2] || !c.cast) continue;
    placed += c.cast;
    weighted += c.cast * (((v[0] - v[1]) / v[2]) * 100);
  }
  if (!placed || placed < all * LEAN_COVERAGE || !stateBase[state]) return null;
  return { margin: weighted / placed, state2024: (stateLead[state] / stateBase[state]) * 100, coverage: placed / all };
}

/** Ballots cast so far as a percentage of the 2024 presidential vote; null without a 2024 figure. */
export const shareOf2024 = (cast: number, base: number | null) => (base ? (cast / base) * 100 : null);

const latest = (feeds: Feeds) => [feeds.returned, feeds.inperson, feeds.requested].map((f) => f.snapshot_date).filter((d): d is string => !!d).sort().at(-1) ?? null;

/** Every state civicAPI has early votes for, most ballots first. */
export function nationOf(feeds: Feeds): Omit<EarlyNation, "fetchedAt"> {
  const codes = new Set([feeds.returned, feeds.inperson, feeds.requested].flatMap((f) => Object.keys(f.regions)).filter((s) => s in STATE_NAMES));
  const list = [...codes].map((state) => ({ state, ...countsOf(feeds, (f) => f.regions[state]), base2024: stateBase[state] ?? null }));
  return { asOf: latest(feeds), states: list.sort((a, b) => b.cast - a.cast || b.requested - a.requested) };
}

/** Cities that run their own election boards, counted with the county they sit in (Illinois). */
const CITY_BOARDS: Record<string, string> = {
  "City of Chicago": "17031",
  "City of Bloomington": "17113",
  "City of Danville": "17183",
  "City of East St Louis": "17163",
  "City of Galesburg": "17095",
  "City of Rockford": "17201",
};

const norm = (name: string) => name.toLowerCase().replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, "").replace(/\bsaint\b/g, "st").replace(/[^a-z]/g, "");
/** Virginia's independent cities (and Baltimore, St. Louis) have county codes from 500 up. */
const isCity = (fips: string) => Number(fips.slice(2)) >= 500;

/**
 * The FIPS code of the county civicAPI calls `name`, from the map's names. A name shared by a county and a city
 * (Fairfax, Richmond, Baltimore) is the county, and "Fairfax City" the city; null when nothing matches.
 */
function fipsOf(name: string, names: Record<string, string>): string | null {
  if (CITY_BOARDS[name] && names[CITY_BOARDS[name]]) return CITY_BOARDS[name];
  const entries = Object.entries(names);
  const exact = entries.filter(([, n]) => norm(n) === norm(name)).map(([f]) => f);
  if (exact.length) return exact.find((f) => !isCity(f)) ?? exact[0];
  const base = name.match(/^(.*\S)\s+city$/i)?.[1];
  return (base && entries.find(([f, n]) => isCity(f) && norm(n) === norm(base))?.[0]) ?? null;
}

/**
 * A state's counties with their counts, most ballots first. Places that match no county are kept under their own
 * names. `byTown` is set when most places match none (New England reports by town); then none is taken for a county,
 * since a town can share its county's name (Hartford).
 */
export function countiesOf(feeds: Feeds, names: Record<string, string>): { counties: EarlyCounty[]; byTown: boolean } {
  const places = [...new Set([feeds.returned, feeds.inperson, feeds.requested].flatMap((f) => Object.keys(f.regions)))];
  const matched = places.map((place) => ({ place, fips: fipsOf(place, names) }));
  const byTown = matched.filter((m) => !m.fips).length > places.length / 2;
  const groups = new Map<string, { fips: string | null; places: string[] }>();
  for (const { place, fips: found } of matched) {
    const fips = byTown ? null : found;
    const key = fips ?? `place:${place}`;
    groups.set(key, { fips, places: [...(groups.get(key)?.places ?? []), place] });
  }
  const merged = (f: EarlyFeed, group: string[]): Tally | undefined => {
    const parts = group.map((p) => f.regions[p]).filter((t): t is Tally => !!t);
    if (!parts.length) return undefined;
    const out: Tally = {};
    for (const [party, { votes }] of parts.flatMap((t) => Object.entries(t))) out[party] = { votes: (out[party]?.votes ?? 0) + votes };
    return out;
  };
  const counties = [...groups.values()].map(({ fips, places: group }) => ({
    name: fips ? names[fips] : group[0],
    fips,
    base2024: fips ? (votes2024[fips]?.[2] ?? null) : null,
    ...countsOf(feeds, (f) => merged(f, group)),
  }));
  return { counties: counties.sort((a, b) => b.cast - a.cast || b.requested - a.requested || a.name.localeCompare(b.name)), byTown };
}

/** The day as many days before the 2024 election as `asOf` is before the 2026 one, for a like-for-like comparison. */
export function priorDate(asOf: string): string {
  const daysOut = Math.round((ELECTION_2026 - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS);
  return new Date(ELECTION_2024 - daysOut * DAY_MS).toISOString().slice(0, 10);
}

const titleCase = (s: string) => s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const ageLabel = (s: string) => s.replace(/^Age\s+/i, "").replace(/\s*-\s*/, "–");

/**
 * One demographic breakdown, adding mail and in-person values together. Age groups keep civicAPI's order, other
 * groups go largest first; empty groups drop out, and a breakdown with nothing in it is null.
 */
export function breakdown(kind: keyof Demographics, parts: readonly Record<string, number>[]): Breakdown | null {
  const totals = new Map<string, number>();
  for (const [label, votes] of parts.flatMap((p) => Object.entries(p))) totals.set(label, (totals.get(label) ?? 0) + votes);
  const rows = [...totals].filter(([, votes]) => votes > 0).map(([label, votes]) => ({ label: kind === "age" ? ageLabel(label) : titleCase(label), votes }));
  if (!rows.length) return null;
  return kind === "age" ? rows : rows.sort((a, b) => b.votes - a.votes);
}

/** A state's totals from its own statewide figures, with its 2024 vote. */
export function stateTotals(state: string, feeds: Feeds): Counts & { base2024: number | null; asOf: string | null } {
  return { ...countsOf(feeds, (f) => f.statewide_total), base2024: stateBase[state] ?? null, asOf: latest(feeds) };
}

/** The 2024 counts for the same day, or null when civicAPI kept neither kind of ballot for it. */
export function priorOf(date: string, returned: EarlyFeed | null, inperson: EarlyFeed | null): Prior | null {
  if (!returned && !inperson) return null;
  const r = sum(returned?.statewide_total);
  const i = sum(inperson?.statewide_total);
  return { date, returned: r, inperson: i, cast: r + i, party: partyOf([returned?.statewide_total, inperson?.statewide_total]) };
}

export const isState = (code: string) => /^[A-Z]{2}$/.test(code) && code in STATE_NAMES && code in stateFips;
