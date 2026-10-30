// Which party holds each seat going into Nov 3, so a called race reads as a hold or a gain.
// Senate and House come from congress-legislators (scripts/build-holders.mjs). House seats are matched by district
// number, so a district redrawn since the last election compares against the member who holds that number now.
import holders from "./holders.json";
import { isEarly, partyOf, type RaceSummary } from "./view";

export type Side = "D" | "R" | "I";

// The 36 governors whose seats are up, by party, as of October 2026.
const GOVERNORS: Record<string, Side> = Object.fromEntries([
  ...["AZ", "CA", "CO", "CT", "HI", "IL", "KS", "MA", "MD", "ME", "MI", "MN", "NM", "NY", "OR", "PA", "RI", "WI"].map((s) => [s, "D" as const]),
  ...["AK", "AL", "AR", "FL", "GA", "IA", "ID", "NE", "NH", "NV", "OH", "OK", "SC", "SD", "TN", "TX", "VT", "WY"].map((s) => [s, "R" as const]),
]);

const table = holders as { senate: Record<string, Side>; special: Record<string, Side>; house: Record<string, Side> };

/** The party holding a race's seat now, or null for measures and seats with no record (a vacancy, say). */
export function holderOf(r: Pick<RaceSummary, "office" | "state" | "district" | "title">): Side | null {
  if (r.office === "senate") return (/special/i.test(r.title) ? table.special[r.state] : table.senate[r.state]) ?? null;
  if (r.office === "house") return table.house[`${r.state}-${r.district ?? 0}`] ?? null;
  if (r.office === "governor") return GOVERNORS[r.state] ?? null;
  return null;
}

/** For a called race: the winning side and whether it takes the seat from another party. Null when uncalled or unknown. */
export function outcomeOf(r: RaceSummary): { side: Side; gain: boolean } | null {
  const won = r.candidates.find((c) => c.winner);
  const holder = holderOf(r);
  if (!won || !holder) return null;
  const p = partyOf(won.party);
  const side: Side = p === "other" ? "I" : p;
  return { side, gain: side !== holder };
}

/**
 * An uncalled race whose current leader is from a different party than holds the seat: a flip if it holds. An early
 * count (see isEarly) says too little to call a possible flip, unless `includeEarly`.
 */
export function leadingFlip(r: RaceSummary, includeEarly = false): Side | null {
  if (r.candidates.some((c) => c.winner) || (!includeEarly && isEarly(r))) return null;
  const [first, second] = r.candidates;
  const holder = holderOf(r);
  if (!holder || !first?.votes || first.votes === second?.votes) return null;
  const p = partyOf(first.party);
  const side: Side = p === "other" ? "I" : p;
  return side === holder ? null : side;
}
