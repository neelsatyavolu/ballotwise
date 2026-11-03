// A made-up DDHQ Pulse for a mock night or preview, so its screens show one that agrees with the made-up count: each
// race's forecast odds before votes, moving toward the count's leader as more is counted, and each chamber's chance
// of control from adding up its races. The day's line is drawn by replaying the night. Loaded only with sim.ts.
import type { Pulse, PulsePoint, PulseRace } from "../ddhq/pulse";
import { stateCloses } from "./polls";
import { HOLDOVER, type RaceSummary } from "./races";
import { raceKey, sideOf } from "./seats";
import { simulatedFrom, simulateRace } from "./sim";

/** How often the replayed line takes a point, and how long before the first polls close it starts. */
const STEP = 10 * 60_000;
const LEAD_IN = 60 * 60_000;
/** Seats Democrats start with and need, as in forecast.ts (an independent who beats the Republican counts with them). */
const CHAMBERS = { senate: { start: HOLDOVER.senate.D, need: 51 }, house: { start: 0, need: 218 } } as const;
/** Races move together on a real night, so the chamber's spread is wider than independent races would give. */
const SHARED = 2.5;
/** The count's lead, in points, that's worth as much as the forecast once a race is fully counted… */
const COUNT_SD_DONE = 1.5;
/** …and how much wider that is with nothing counted. */
const COUNT_SD_SPAN = 14;
/** Counted share assumed when a count's reporting is unknown. */
const UNKNOWN_REPORTING = 0.3;

/** Standard normal CDF (Abramowitz and Stegun 7.1.26). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

const notRepublican = (c: RaceSummary["candidates"][number]) => sideOf(c.party) === "D" || sideOf(c.party) === "I";
const isRepublican = (c: RaceSummary["candidates"][number]) => sideOf(c.party) === "R";

/** The chance the seat goes to the Democrats (or the independent running against the Republican), as counted so far. */
function seatChance(r: RaceSummary): number {
  const winner = r.candidates.find((c) => c.winner);
  if (winner) return notRepublican(winner) ? 1 : 0;
  const odds = r.signal?.forecast?.odds;
  const prior = odds?.D ?? odds?.I ?? (odds?.R !== undefined ? 1 - odds.R : 0.5);
  const left = r.candidates.find(notRepublican);
  const right = r.candidates.find(isRepublican);
  if (!r.total || !left || !right) return prior;
  const counted = r.reportingUnknown ? UNKNOWN_REPORTING : Math.min(1, r.reporting / 100);
  const count = phi((left.pct - right.pct) / (COUNT_SD_DONE + COUNT_SD_SPAN * (1 - counted)));
  const weight = Math.sqrt(counted);
  return (1 - weight) * prior + weight * count;
}

const lastWord = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
const percent = (p: number) => Math.min(99, Math.max(1, Math.round(p * 10_000) / 100));

/** A race's Pulse: Senate and governor races with a rating that aren't called, as DDHQ models them. */
function racePulse(r: RaceSummary): PulseRace | null {
  if ((r.office !== "senate" && r.office !== "governor") || !r.rating || r.candidates.some((c) => c.winner)) return null;
  const p = seatChance(r);
  const pick = p >= 0.5 ? r.candidates.find(notRepublican) : r.candidates.find(isRepublican);
  if (!pick) return null;
  return { name: lastWord(pick.name), side: sideOf(pick.party) ?? "I", chance: Math.min(99, Math.round(Math.max(p, 1 - p) * 10_000) / 100) };
}

/** Each chamber's chance of Democratic control, in percent, with the races as counted at that moment. */
function chamberPoint(races: readonly RaceSummary[], at: number): PulsePoint {
  const point: PulsePoint = { at };
  for (const office of ["senate", "house"] as const) {
    const chances = races.filter((r) => r.office === office).map(seatChance);
    const expected = CHAMBERS[office].start + chances.reduce((s, p) => s + p, 0);
    const spread = Math.sqrt(chances.reduce((s, p) => s + p * (1 - p), 0)) * SHARED + 0.5;
    point[office] = percent(phi((expected - (CHAMBERS[office].need - 0.5)) / spread));
  }
  return point;
}

/** The made-up Pulse at `at`, from the races the last made-up overview used. Empty until that overview exists. */
export function mockPulse(at: number): Pulse {
  const real = simulatedFrom();
  if (!real.length) return { at: null, chambers: {}, races: {}, history: [] };
  const counted = (t: number) => real.map((r) => simulateRace(r, t));
  const now = counted(at);
  const races: Record<string, PulseRace> = {};
  for (const r of now) {
    const pulse = racePulse(r);
    if (pulse) races[raceKey(r.office, r.state, r.district)] = pulse;
  }
  const closes = real.map((r) => stateCloses(r.state)).filter((c): c is number => c !== null);
  const start = (closes.length ? Math.min(...closes) : at) - LEAD_IN;
  const history: PulsePoint[] = [];
  for (let t = start; t < at; t += STEP) history.push(chamberPoint(counted(t), t));
  const current = chamberPoint(now, at);
  history.push(current);
  const chamber = (dem: number | undefined) => (dem === undefined ? undefined : { dem, rep: Math.round((100 - dem) * 100) / 100 });
  return { at, chambers: { senate: chamber(current.senate), house: chamber(current.house) }, races, history };
}
