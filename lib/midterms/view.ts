// Display helpers shared by the tracker's client components. Type-only imports keep zod out of the bundle.
import type { Signal } from "./odds";
import type { Candidate, Office, Party, RaceSummary, Rating, Tally } from "./races";
import states from "./states.json";

export type { Candidate, Office, Party, RaceSummary, Rating, Signal, Tally };
export type Overview = {
  races: RaceSummary[];
  balance: { senate: Tally; house: Tally; governor: Tally };
  fetchedAt: number;
  stale: boolean;
  /** When market and poll ratings were last refreshed; null before the first refresh. */
  ratings: { updatedAt: number | null };
};

export const STATE_NAMES: Record<string, string> = Object.fromEntries(states.map(([, postal, name]) => [postal, name]));

export const OFFICE_LABEL: Record<Office, string> = { senate: "Senate", house: "House", governor: "Governor", measure: "Ballot measures" };

export const RATING_LABEL: Record<Rating, string> = {
  tossup: "Toss-up",
  "lean-d": "Lean D",
  "lean-r": "Lean R",
  "lean-i": "Lean I",
  "likely-d": "Likely D",
  "likely-r": "Likely R",
  "likely-i": "Likely I",
};
/** Most competitive first. */
export const RATING_ORDER: Rating[] = ["tossup", "lean-d", "lean-r", "lean-i", "likely-d", "likely-r", "likely-i"];

export function partyOf(party: string): Party {
  if (/^Democrat/i.test(party)) return "D";
  if (/^Republican/i.test(party)) return "R";
  return "other";
}

/** CSS color for a candidate: party colors for partisan races, yes/no colors for measures. */
export function colorOf(c: { name: string; party: string }): string {
  if (/^yes$/i.test(c.name)) return "var(--yes)";
  if (/^no$/i.test(c.name)) return "var(--no)";
  const p = partyOf(c.party);
  return p === "D" ? "var(--dem)" : p === "R" ? "var(--rep)" : "var(--oth)";
}

/** Short party tag: D, R, or the first letters of anything else. */
export function partyTag(party: string): string {
  const p = partyOf(party);
  if (p !== "other") return p;
  if (!party || /nonpartisan/i.test(party)) return "";
  return party.length <= 4 ? party : party.slice(0, 3);
}

/** A map/table fill for a leader winning by `margin` points; stronger the wider the lead. */
export function shade(color: string, margin: number): string {
  const strength = margin >= 20 ? 92 : margin >= 10 ? 70 : margin >= 5 ? 50 : 32;
  return `color-mix(in srgb, ${color} ${strength}%, var(--sheet))`;
}

/** A 2024-style margin label: "D+12.3", "R+4.0", or "Even". */
export function marginLabel(dMinusR: number): string {
  if (Math.abs(dMinusR) < 0.05) return "Even";
  return `${dMinusR > 0 ? "D" : "R"}+${Math.abs(dMinusR).toFixed(1)}`;
}

export const fmt = (n: number) => n.toLocaleString("en-US");
export const pct = (n: number) => `${n.toFixed(1)}%`;

/** The leader and their lead over second place, in points; null before any votes. */
export function lead(candidates: readonly { name: string; party: string; votes: number; pct: number }[]) {
  const [first, second] = candidates;
  if (!first || first.votes === 0) return null;
  return { leader: first, margin: first.pct - (second?.pct ?? 0) };
}

export function raceLabel(r: Pick<RaceSummary, "office" | "state" | "district" | "title">): string {
  const state = STATE_NAMES[r.state] ?? r.state;
  if (r.office === "senate") return `${state} Senate${/special/i.test(r.title) ? " (special)" : ""}`;
  if (r.office === "governor") return `${state} Governor`;
  if (r.office === "house") return r.district === 0 ? `${r.state} at-large` : `${r.state}-${r.district}`;
  // Some measure names carry a description after " - "; that shows separately as the measure's summary.
  return r.title.split(" - ")[0].replace(new RegExp(`^${state}\\s+`), "").trim();
}

/** Sort key: rated races by competitiveness, then by state and district. */
export function compareRaces(a: RaceSummary, b: RaceSummary): number {
  const ra = a.rating ? RATING_ORDER.indexOf(a.rating) : 99;
  const rb = b.rating ? RATING_ORDER.indexOf(b.rating) : 99;
  return ra - rb || a.state.localeCompare(b.state) || (a.district ?? 0) - (b.district ?? 0) || a.title.localeCompare(b.title);
}

export function timeAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
}

/** Democratic minus Republican share in a set of results, or Yes minus No for a measure; null when neither pair is present. */
export function twoWay(candidates: readonly { name: string; party: string; pct: number }[]): number | null {
  const yes = candidates.find((c) => /^yes$/i.test(c.name));
  const no = candidates.find((c) => /^no$/i.test(c.name));
  if (yes && no) return yes.pct - no.pct;
  const d = candidates.find((c) => partyOf(c.party) === "D");
  const r = candidates.find((c) => partyOf(c.party) === "R");
  return d && r ? d.pct - r.pct : null;
}

/** Races of one office not yet called, by which party's candidate leads the count. */
export function leading(races: readonly RaceSummary[], office: Office): Record<Party, number> {
  const out: Record<Party, number> = { D: 0, R: 0, other: 0 };
  for (const r of races) {
    if (r.office !== office || r.candidates.some((c) => c.winner)) continue;
    const ahead = lead(r.candidates);
    // A tie leads for nobody.
    if (ahead && ahead.margin > 0) out[partyOf(ahead.leader.party)] += 1;
  }
  return out;
}

/** Races of one office with no votes counted yet, by which party the prediction markets (Kalshi and Polymarket, averaged) favor. */
export function projected(races: readonly RaceSummary[], office: Office): Record<Party, number> {
  const out: Record<Party, number> = { D: 0, R: 0, other: 0 };
  for (const r of races) {
    if (r.office !== office || r.candidates.some((c) => c.winner) || lead(r.candidates)) continue;
    const [first, second] = Object.entries(r.signal?.market?.odds ?? {}).sort((a, b) => b[1] - a[1]);
    // An even market favors nobody.
    if (!first || first[1] === second?.[1]) continue;
    out[first[0] === "I" ? "other" : (first[0] as "D" | "R")] += 1;
  }
  return out;
}

/** Ballot measures: passed, failed, and still counting. A measure passes when "Yes" is called. */
export function measureCount(races: readonly RaceSummary[]) {
  const out = { passed: 0, failed: 0, counting: 0, yesAhead: 0, noAhead: 0 };
  for (const r of races) {
    if (r.office !== "measure") continue;
    const won = r.candidates.find((c) => c.winner);
    if (won) {
      if (/^yes$/i.test(won.name)) out.passed += 1;
      else out.failed += 1;
      continue;
    }
    out.counting += 1;
    const ahead = lead(r.candidates);
    if (!ahead || ahead.margin <= 0) continue;
    if (/^yes$/i.test(ahead.leader.name)) out.yesAhead += 1;
    else out.noAhead += 1;
  }
  return out;
}

/** Map fill for a race before any votes: forecast color, strongest for Likely. */
export function ratingFill(rating: Rating | null): string {
  if (!rating) return "var(--rule-strong)";
  if (rating === "tossup") return "var(--tossup)";
  const color = rating.endsWith("-d") ? "var(--dem)" : rating.endsWith("-r") ? "var(--rep)" : "var(--oth)";
  return `color-mix(in srgb, ${color} ${rating.startsWith("lean") ? 35 : 60}%, var(--sheet))`;
}

const SIDE_NAME = { D: "Dem", R: "Rep", I: "Ind" } as const;

/** "Markets: Rep 62% · Polls: D+2.1 (5)", the evidence behind a race's rating, or null when there is none. */
export function signalLine(signal: Signal | null | undefined): string | null {
  if (!signal) return null;
  const parts: string[] = [];
  if (signal.market) {
    const [side, p] = (Object.entries(signal.market.odds) as [keyof typeof SIDE_NAME, number][]).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (side) parts.push(`Markets: ${SIDE_NAME[side]} ${Math.round(p * 100)}%`);
  }
  if (signal.polls) parts.push(`Polls: ${marginLabel(signal.polls.margin)} (${signal.polls.count})`);
  return parts.length ? parts.join(" · ") : null;
}
