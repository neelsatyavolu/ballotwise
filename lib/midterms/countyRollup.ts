// New England states report by town (10-digit codes), but the state maps on the office pages and walls are drawn by
// county (5-digit codes). A town's code starts with its county's, so towns roll up into their counties for those maps.
import type { CountyResult } from "./races";
import countyNames from "./countyNames.json";
import { isTownCode } from "./view";

const NAMES = countyNames as Record<string, Record<string, string>>;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * One county from its towns: votes summed per candidate, and its share reported the average over every town, so
 * towns with nothing in yet count as none (weighting by votes would put a county with one big town in at 99%).
 */
function rollUp(state: string, fips: string, towns: readonly CountyResult[]): CountyResult {
  const total = sum(towns.map((t) => t.total));
  const votes = new Map<string, { party: string; votes: number }>();
  for (const t of towns) {
    for (const c of t.candidates) votes.set(c.name, { party: votes.get(c.name)?.party ?? c.party, votes: (votes.get(c.name)?.votes ?? 0) + c.votes });
  }
  const counted = towns.filter((t) => t.total > 0);
  const expected = towns.every((t) => t.expected !== undefined) ? sum(towns.map((t) => t.expected ?? 0)) : undefined;
  return {
    fips,
    name: NAMES[state]?.[fips] ?? fips,
    total,
    reporting: sum(towns.map((t) => Math.min(100, t.reporting))) / towns.length,
    towns: { in: counted.length, of: towns.length },
    ...(counted.length > 0 && counted.every((t) => t.reportingUnknown) ? { reportingUnknown: true as const } : {}),
    ...(expected !== undefined ? { expected } : {}),
    ...(towns.every((t) => t.done) ? { done: true as const } : {}),
    candidates: [...votes].map(([name, v]) => ({ name, party: v.party, votes: v.votes, pct: total > 0 ? (v.votes / total) * 100 : 0 })).sort((a, b) => b.votes - a.votes),
    baseline2024: null,
    pres2024: null,
  };
}

/**
 * The race's places as counties, for a county map: counties as they are, and towns rolled up into theirs. A county
 * with both its own row and towns (DDHQ's counties beside civicAPI's towns) shows whichever has more votes.
 */
export function countiesForMap(state: string, places: readonly CountyResult[]): CountyResult[] {
  const towns = places.filter((p) => isTownCode(p.fips));
  if (!towns.length) return [...places];
  const out = new Map(places.filter((p) => p.fips && !isTownCode(p.fips)).map((p) => [p.fips!, p]));
  const groups = new Map<string, CountyResult[]>();
  for (const t of towns) groups.set(t.fips!.slice(0, 5), [...(groups.get(t.fips!.slice(0, 5)) ?? []), t]);
  for (const [fips, list] of groups) {
    const rolled = rollUp(state, fips, list);
    const own = out.get(fips);
    if (!own || rolled.total > own.total) out.set(fips, rolled);
  }
  return [...out.values()];
}
