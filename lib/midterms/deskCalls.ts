// Decision Desk HQ's calls, read off its public balance-of-power pages (lib/ddhq/pulse.ts), for races our own sources
// haven't called: civicAPI calls later than DDHQ, and a connected screen's DDHQ feed misses races it couldn't match.
import type { PulseWinner } from "../ddhq/pulse";
import { raceKey } from "./seats";
import { partyOf, type RaceSummary } from "./view";

const surname = (name: string) => name.trim().replace(/,? (Jr|Sr|II|III|IV)\.?$/i, "").split(/\s+/).at(-1)?.toLowerCase() ?? "";

/**
 * `races` with DDHQ's call on each race not already called: the candidate named (by last name, else the only one of
 * the winner's party) marked the winner, with the call's time. A race whose winner can't be matched is left as it is,
 * and so is one sharing its seat key with another (two races for one state's Senate seats).
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
    if (!won || r.calledFor || r.callPending || r.candidates.some((c) => c.winner)) return r;
    const named = r.candidates.filter((c) => surname(c.name) === surname(won.name));
    const sided = r.candidates.filter((c) => { const p = partyOf(c.party); return (p === "other" ? "I" : p) === won.side; });
    const pick = named.length === 1 ? named[0] : sided.length === 1 ? sided[0] : null;
    if (!pick) return r;
    return {
      ...r,
      candidates: r.candidates.map((c) => (c === pick ? { ...c, winner: true } : c)),
      calledFor: pick.name,
      call: { id: r.id, at: won.at, winner: pick.name, replaced: null, withdrawn: false as const },
    };
  });
}
