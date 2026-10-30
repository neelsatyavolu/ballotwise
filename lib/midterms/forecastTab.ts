// The Forecast tab's chamber-level numbers: wording for the headline, seats by rating and expected seats.
// Pure functions over the race catalog, so the tab works from per-race forecasts until chamber odds arrive.
import { safeSide } from "./explore";
import type { ChamberView as ServerView } from "./forecast";
import { chances, type Office, type RaceSummary, type Tally } from "./view";

export type ForecastOffice = Exclude<Office, "measure">;

export type RatingCounts = { safeD: number; likelyD: number; leanD: number; tossup: number; leanR: number; likelyR: number; safeR: number; other: number };

/** One chamber (or the governorships) as the Forecast tab shows it. `dControl` is null when there's nothing to control or no simulation yet. */
export type ChamberView = {
  dControl: number | null;
  dSeats: number;
  rSeats: number;
  ratings: RatingCounts;
  /** Seats not on the ballot this year (and seats already called), already in the rating counts as Safe. */
  notUp: { D: number; R: number; other: number };
  majority: number | null;
  total: number;
};

export const RATING_KEYS = ["safeD", "likelyD", "leanD", "tossup", "leanR", "likelyR", "safeR"] as const;
export type RatingKey = (typeof RATING_KEYS)[number];

/** Which bucket a race falls in, from its forecast rating; races with no forecast (or an independent favored) are "other". */
export function ratingKey(r: RaceSummary): RatingKey | "other" {
  if (r.rating === "tossup") return "tossup";
  if (r.rating) {
    const [tier, side] = r.rating.split("-");
    if (side === "i") return "other";
    return `${tier}${side.toUpperCase()}` as RatingKey;
  }
  const safe = safeSide(r);
  return safe === "D" ? "safeD" : safe === "R" ? "safeR" : "other";
}

/**
 * Seats by rating and expected seats for one office, from each race's forecast. Called races and seats not up
 * this year come from the tally (they count as Safe); an uncalled race adds each side's chance of winning it.
 */
export function chamberFromRaces(races: readonly RaceSummary[], office: ForecastOffice, tally: Tally): ChamberView {
  const ratings: RatingCounts = { safeD: tally.D, likelyD: 0, leanD: 0, tossup: 0, leanR: 0, likelyR: 0, safeR: tally.R, other: tally.other };
  let d = tally.D;
  let r = tally.R;
  for (const race of races) {
    if (race.office !== office || race.candidates.some((c) => c.winner)) continue;
    ratings[ratingKey(race)] += 1;
    const odds = chances(race.signal);
    d += odds?.D ?? 0;
    r += odds?.R ?? 0;
  }
  return {
    dControl: null,
    dSeats: Math.round(d),
    rSeats: Math.round(r),
    ratings,
    notUp: { D: tally.D, R: tally.R, other: tally.other },
    majority: office === "governor" ? null : tally.majority,
    total: tally.total,
  };
}

/**
 * The server's simulated chamber in the tab's terms: seats not up this year join the Safe counts, and governors
 * show projected governorships rather than a chance of control. Without a simulation yet, the race-based view stands.
 */
export function withServer(view: ChamberView, server: ServerView | null | undefined, office: ForecastOffice): ChamberView {
  if (!server) return view;
  const { ratings, notUp } = server;
  return {
    dControl: office === "governor" ? null : server.dControl,
    dSeats: Math.round(server.dSeats),
    rSeats: Math.round(server.rSeats),
    ratings: { ...ratings, safeD: ratings.safeD + notUp.D, safeR: ratings.safeR + notUp.R, other: ratings.other + notUp.other },
    notUp,
    majority: office === "governor" ? null : server.majority,
    total: view.total,
  };
}

/**
 * The seat bar's projection before any votes in `office` are counted: the forecast's expected seats beyond those
 * already decided (seats not up this year, and called races), and Democrats' chance of control once the server's
 * simulation has run. Null once counting starts, when the bar shows seats won and led instead.
 */
export function projection(races: readonly RaceSummary[], office: ForecastOffice, tally: Tally, server: ServerView | null | undefined): { ahead: { D: number; R: number; other: number }; dControl: number | null } | null {
  if (races.some((r) => r.office === office && r.total > 0)) return null;
  const view = withServer(chamberFromRaces(races, office, tally), server, office);
  return { ahead: { D: Math.max(0, view.dSeats - tally.D), R: Math.max(0, view.rSeats - tally.R), other: 0 }, dControl: view.dControl };
}

/** How sure the forecast is, in words, from the favorite's chance. */
export function confidenceWord(p: number): string | null {
  if (p < 0.6) return null;
  if (p < 0.7) return "narrowly favored";
  if (p < 0.8) return "favored";
  if (p < 0.95) return "likely";
  return "very likely";
}

const CHAMBER_NAME: Record<ForecastOffice, string> = { house: "House", senate: "Senate", governor: "governorships" };

/** A run of headline text and how it's colored: a party, the confidence word, the chamber, or plain. */
export type HeadlinePart = { text: string; tone: "d" | "r" | "word" | "strong" | "plain" };

const PARTY_NAME = { D: "Democrats", R: "Republicans" } as const;

/**
 * The hero's headline, after DDHQ's: "Democrats are likely to win the House", or "The Senate is a toss-up".
 * Governors have no chamber to control, so their headline is about holding the most governorships.
 */
export function headline(office: ForecastOffice, view: ChamberView): HeadlinePart[] {
  const chamber = CHAMBER_NAME[office];
  const ahead = view.dSeats === view.rSeats ? null : view.dSeats > view.rSeats ? "D" : "R";
  const party = (p: "D" | "R"): HeadlinePart => ({ text: PARTY_NAME[p], tone: p === "D" ? "d" : "r" });
  if (office === "governor" || view.dControl === null) {
    if (!ahead) return [{ text: office === "governor" ? "Governorships" : `The ${chamber}`, tone: "strong" }, { text: office === "governor" ? "are evenly split" : "is too close to call", tone: "plain" }];
    return [party(ahead), { text: office === "governor" ? "are projected to hold the most" : "are projected to win the", tone: "plain" }, { text: chamber, tone: "strong" }];
  }
  const d = view.dControl;
  const word = confidenceWord(Math.max(d, 1 - d));
  if (!word) return [{ text: `The ${chamber}`, tone: "strong" }, { text: "is a", tone: "plain" }, { text: "toss-up", tone: "word" }];
  return [party(d >= 0.5 ? "D" : "R"), { text: "are", tone: "plain" }, { text: word, tone: "word" }, { text: "to win the", tone: "plain" }, { text: chamber, tone: "strong" }];
}

/** The change in a value over the last week of history, or null when the history doesn't reach back a week. */
export function weekChange(points: readonly (readonly [number, number])[]): number | null {
  if (points.length < 2) return null;
  const [lastT, lastV] = points[points.length - 1];
  const weekAgo = lastT - 7 * 86_400;
  const before = [...points].reverse().find(([t]) => t <= weekAgo);
  return before ? lastV - before[1] : null;
}
