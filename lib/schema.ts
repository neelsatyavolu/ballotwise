import { z } from "zod";

const url = z.string().trim().regex(/^https?:\/\/\S+$/i, "must be an http(s) URL");
const text = (max: number) => z.string().trim().min(1).max(max);
/** Every factual claim carries at least one source URL. */
const sourced = z.object({ text: text(600), sources: z.array(url).min(1).max(5) });

// Stances share one scale for voters and candidates: -2 strongly side A ... +2 strongly side B.
export const STANCE_MIN = -2;
export const STANCE_MAX = 2;
const stance = z.number().int().min(STANCE_MIN).max(STANCE_MAX);

export const issueSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  title: text(60),
  question: text(200),
  sideA: text(140),
  sideB: text(140),
});

export const candidateRefSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{2,60}$/),
  name: text(100),
  party: z.string().trim().max(60).nullable(),
  /** For a measure side this holds the ballot label's "A yes vote means..." sentence, which runs long. */
  ballotDesignation: z.string().trim().max(300).nullable(),
  incumbent: z.boolean(),
});

export const contestKinds = ["office", "measure"] as const;

export const raceSchema = z.object({
  /** A ballot measure is stored as a race whose two "candidates" are its Yes and No sides. Absent on older races, which are offices. */
  kind: z.enum(contestKinds).optional(),
  /** Official measure titles run long, e.g. California's Proposition 41 at 134 characters. */
  title: text(200),
  election: text(160),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  jurisdiction: text(120),
  /** A measure's summary includes current law and fiscal impact, so it gets more room than a single claim. */
  office: z.object({ text: text(1200), sources: z.array(url).min(1).max(5) }),
  votingRule: z.string().trim().max(200).nullable(),
  /** Seats filled; older saved races don't have it, see seatsOf. */
  seats: z.number().int().min(1).max(12).optional(),
  candidates: z.array(candidateRefSchema).min(1).max(12),
  issues: z.array(issueSchema).min(3).max(7),
  sources: z.array(url).min(1).max(12),
});

export const raceResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("race"), race: raceSchema }),
  z.object({
    kind: z.literal("choose"),
    options: z.array(z.object({ label: text(140), query: text(200), date: z.string().trim().max(20).nullable() })).min(2).max(8),
  }),
  z.object({ kind: z.literal("none"), reason: text(300) }),
]);

export const contestLevels = ["federal", "state", "county", "city", "school", "judicial", "special-district"] as const;

export const ballotContestsSchema = z.object({
  elections: z
    .array(
      z.object({
        name: text(160),
        date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
        contests: z
          .array(z.object({ label: text(140), query: text(220), level: z.enum(contestLevels), kind: z.enum(contestKinds).default("office") }))
          .max(40),
      }),
    )
    .max(4),
});

export const positionSchema = z.object({
  issueId: z.string(),
  stance: stance.nullable(),
  summary: z.string().trim().max(500),
  quote: z.string().trim().max(400).nullable(),
  sources: z.array(url).max(5),
  /** When no sourced stance exists: an inference from the candidate's other positions. Null means none could be made; absent means not tried yet. */
  estimate: z.object({ stance, basis: text(300) }).nullable().optional(),
});

export const profileSchema = z.object({
  summary: text(500),
  background: z.array(sourced).max(6),
  positions: z.array(positionSchema),
  record: z.array(sourced).max(6),
  funding: sourced.nullable(),
  endorsements: z.array(sourced).max(6),
  website: url.nullable(),
});

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

/** How many candidates a voter picks: the researched seat count, else read from a "Vote for 2" style rule. */
export function seatsOf(race: Pick<Race, "seats" | "votingRule">): number {
  if (race.seats) return race.seats;
  const m = race.votingRule?.match(/vote for (?:up to |no more than )?(\d+|one|two|three|four|five|six|seven)\b/i) ?? race.votingRule?.match(/\b(\d+|two|three|four|five|six|seven) (?:open )?seats\b/i);
  const n = m ? (NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1])) : 1;
  return n >= 1 && n <= 12 ? n : 1;
}

export function isMeasure(race: Pick<Race, "kind">): boolean {
  return race.kind === "measure";
}

/** The stance used for matching: the sourced one, else the labelled estimate. */
export function stanceOf(position: Position): number | null {
  return position.stance ?? position.estimate?.stance ?? null;
}

/** issueId → stance for one candidate, for matching. */
export function profileStances(profile: Profile): Record<string, number | null> {
  return Object.fromEntries(profile.positions.map((p) => [p.issueId, stanceOf(p)]));
}

export type Issue = z.infer<typeof issueSchema>;
export type CandidateRef = z.infer<typeof candidateRefSchema>;
export type Race = z.infer<typeof raceSchema>;
export type ContestKind = (typeof contestKinds)[number];
export type ContestLevel = (typeof contestLevels)[number];
export type RaceResult = z.infer<typeof raceResultSchema>;
export type BallotContests = z.infer<typeof ballotContestsSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Sourced = z.infer<typeof sourced>;
