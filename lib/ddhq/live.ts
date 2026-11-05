import type { RaceSummary } from "../midterms/races";
import { deskKeyFor, overlayLive } from "./apply";
import type { ResultsSource } from "./source";
import type { DdhqRace, DdhqSeat } from "./votes";

type Seated = Pick<RaceSummary, "office" | "state" | "district" | "title" | "local">;

/** The seats a connected screen asks DDHQ about: every Senate, House and governor race, not measures or local races. */
export function deskSeats(races: readonly Seated[]): DdhqSeat[] {
  const seen = new Set<string>();
  const out: DdhqSeat[] = [];
  for (const race of races) {
    if (race.office === "measure" || race.local) continue;
    const seat: DdhqSeat = { state: race.state, office: race.office, district: race.office === "house" ? (race.district ?? 0) : null, special: /special/i.test(race.title) };
    const key = deskKeyFor(race);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seat);
  }
  return out;
}

/**
 * A public payload (the overview or one race page) as a connected screen shows it, with the same overlay the website
 * runs in the browser (lib/ddhq/apply.ts), so the iOS app needn't keep its own copy of the source rules.
 */
export function deskView<T>(path: string, data: T, results: readonly { key: string; race: DdhqRace | null }[], source: ResultsSource = "auto"): T {
  const desk = new Map<string, DdhqRace>();
  for (const { key, race } of results) if (race) desk.set(key, race);
  return overlayLive(path, data, desk, undefined, source);
}
