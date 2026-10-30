// Display helpers shared by the tracker's client components. Type-only imports keep zod out of the bundle.
import type { CallEvent } from "./calls";
import type { Coverage } from "./coverage";
import type { Signal } from "./odds";
import type { Candidate, Office, Party, RaceSummary, Rating, Tally } from "./races";
import states from "./states.json";

export type { CallEvent, Candidate, Office, Party, RaceSummary, Rating, Signal, Tally };
export type Overview = {
  races: RaceSummary[];
  balance: { senate: Tally; house: Tally; governor: Tally };
  fetchedAt: number;
  stale: boolean;
  /** When market and poll ratings were last refreshed; null before the first refresh. */
  ratings: { updatedAt: number | null };
  /** The latest call changes across every race, newest first: calls, changed calls and withdrawals (winner null). */
  callEvents?: CallEvent[];
  /** Every call change per office, so the feed can say how many there are beyond the latest window. */
  callEventCounts?: Record<Office, number>;
  /** Races listed per office against how many there should be, and how many civicAPI left out of its latest answer. */
  coverage?: Coverage;
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

/**
 * A map/table fill for a leader winning by `margin` points; stronger the wider the lead.
 * Under 15% reporting a lead says little, so it stays at the palest step whatever its size.
 */
export function shade(color: string, margin: number, reporting = 100): string {
  const strength = reporting < 15 ? 32 : margin >= 20 ? 92 : margin >= 10 ? 70 : margin >= 5 ? 50 : 32;
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
  // From raw votes, so a one-vote lead isn't rounded into a tie.
  const total = candidates.reduce((sum, c) => sum + c.votes, 0);
  return { leader: first, margin: ((first.votes - (second?.votes ?? 0)) / total) * 100 };
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
  return ra - rb || favoriteChance(a) - favoriteChance(b) || a.state.localeCompare(b.state) || (a.district ?? 0) - (b.district ?? 0) || a.title.localeCompare(b.title);
}

type Odds = Partial<Record<"D" | "R" | "I", number>>;

/**
 * How far a midterm polling average typically misses the final margin, in points (one standard deviation).
 * Senate polls missed by about 5 points on average in 2018 and 2022 (AAPOR's 2024 task force report).
 */
const POLL_ERROR_SD = 6;
/**
 * Traded volume at which a market's price and a polling average count equally. Market calibration improves with
 * volume (Kalshi's 2026 calibration study), and thin down-ballot markets did worse than poll-based models in 2024.
 */
const EVEN_VOLUME = 50_000;

/** A polling margin (Democrat minus Republican) as each party's chance, given polling averages' usual miss. */
export function pollOdds(margin: number): { D: number; R: number } {
  // Logistic approximation of the normal distribution.
  const d = 1 / (1 + Math.exp((-1.702 * margin) / POLL_ERROR_SD));
  return { D: d, R: 1 - d };
}

/**
 * Each side's chance from all the evidence: the market price, pulled toward the polling average as the market gets
 * thinner, or the polls alone with no market. Polls join a market only with two or more pollsters, and not in a race
 * with an independent, where a Democrat-minus-Republican margin can't be read as chances.
 */
export function chances(signal: Pick<Signal, "market" | "polls"> | null | undefined): Odds | null {
  const market = signal?.market && Object.keys(signal.market.odds).length ? signal.market : null;
  const polls = signal?.polls ?? null;
  if (!market) return polls ? pollOdds(polls.margin) : null;
  if (!polls || polls.count < 2 || market.odds.I || market.volume === undefined) return market.odds;
  const w = market.volume / (market.volume + EVEN_VOLUME);
  const p = pollOdds(polls.margin);
  return { D: w * (market.odds.D ?? 0) + (1 - w) * p.D, R: w * (market.odds.R ?? 0) + (1 - w) * p.R };
}

/** The favorite's chance, 0.5 for a coin flip; 1 with no market or polls, so unrated races sort last. */
export function favoriteChance(r: Pick<RaceSummary, "signal">): number {
  const c = chances(r.signal);
  return c ? Math.max(...Object.values(c)) : 1;
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
