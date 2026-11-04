// Decision Desk HQ's calls, read off its public balance-of-power pages (lib/ddhq/pulse.ts), for races our own sources
// haven't called: civicAPI calls later than DDHQ, and a connected screen's DDHQ feed misses races it couldn't match.
import type { PulseSeats, PulseWinner } from "../ddhq/pulse";
import type { Tally } from "./races";
import { raceKey } from "./seats";
import { partyOf, type RaceSummary } from "./view";

/** A name's words, ignoring accents, case, hyphens and periods: "Kamlager-Dove" and "Kamlager Dove" read the same. */
const words = (name: string) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/,? (jr|sr|ii|iii|iv)\.?$/, "").replace(/[-.']/g, " ").split(/\s+/).filter(Boolean);
/** Whether two spellings name the same candidate: the same last word, or one's last name held whole in the other's. */
function sameName(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return false;
  if (x.at(-1) === y.at(-1)) return true;
  const tail = (w: string[]) => w.slice(1).join(" ");
  return (y.length > 1 && x.join(" ").endsWith(tail(y))) || (x.length > 1 && y.join(" ").endsWith(tail(x)));
}

/**
 * `races` with DDHQ's call on each race not already called: the candidate named (by name, ignoring accents and
 * hyphens, else the only one of the winner's party) marked the winner, with the call's time. A race our call log holds
 * (callPending: the count and the recorded call disagree) takes DDHQ's call too. A race whose winner can't be matched
 * is left as it is, and so is one sharing its seat key with another (two races for one state's Senate seats).
 */
export function withDeskCalls<T extends RaceSummary>(races: readonly T[], winners: Readonly<Record<string, PulseWinner>> | undefined): T[] {
  if (!winners) return [...races];
  const keyOf = (r: RaceSummary) => (r.office === "measure" ? null : raceKey(r.office, r.state, r.district));
  const counts = new Map<string, number>();
  for (const r of races) {
    const key = keyOf(r);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return races.map((r) => {
    const key = keyOf(r);
    const won = key && counts.get(key) === 1 ? winners[key] : undefined;
    if (!won || r.calledFor || r.candidates.some((c) => c.winner)) return r;
    const named = r.candidates.filter((c) => sameName(c.name, won.name));
    const sided = r.candidates.filter((c) => { const p = partyOf(c.party); return (p === "other" ? "I" : p) === won.side; });
    const pick = named.length === 1 ? named[0] : sided.length === 1 ? sided[0] : null;
    if (!pick) return r;
    return {
      ...r,
      candidates: r.candidates.map((c) => (c === pick ? { ...c, winner: true } : c)),
      calledFor: pick.name,
      callPending: undefined,
      call: { id: r.id, at: won.at, winner: pick.name, replaced: null, withdrawn: false as const },
    };
  });
}

type Balance = { senate: Tally; house: Tally; governor: Tally };

/**
 * `b` with the House's and Senate's seats as DDHQ counts them (its balance-of-power pages), so the seat bars match
 * DDHQ's own tally even where a race it has called isn't called here yet; `kept` carries chambers already set that
 * way (a connected screen recounts after its DDHQ overlay). Governors keep the tracker's own count.
 */
export function withDeskSeats(b: Balance, seats: Partial<Record<"senate" | "house", PulseSeats>> | undefined, kept?: Balance): Balance {
  const one = (office: "senate" | "house"): Tally => {
    const desk = seats?.[office];
    if (desk) return { ...b[office], ...desk, uncalled: b[office].uncalled, source: "ddhq" };
    return kept?.[office].source === "ddhq" ? kept[office] : b[office];
  };
  return { ...b, senate: one("senate"), house: one("house") };
}
