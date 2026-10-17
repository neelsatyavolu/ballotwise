import { STANCE_MAX, STANCE_MIN } from "./schema";

/** A voter's answer to one issue. `stance` null means skipped; weight 1–3 is how much it matters. */
export type Answer = { stance: number | null; weight: 1 | 2 | 3 };
export type Answers = Readonly<Record<string, Answer>>;
/** Voter corrections to a candidate's stance: candidateId → issueId → stance (null = "no position"). */
export type Overrides = Readonly<Record<string, Readonly<Record<string, number | null>>>>;

export type IssueMatch = {
  issueId: string;
  voter: number | null;
  candidate: number | null;
  weight: number;
  agreement: number | null;
  overridden: boolean;
};

export type CandidateMatch = {
  candidateId: string;
  /** 0–100, or null when no answered issue has a known candidate stance. */
  score: number | null;
  /** Share of the voter's answered weight that has a known candidate stance, 0–1. */
  coverage: number;
  issues: IssueMatch[];
};

const SPAN = STANCE_MAX - STANCE_MIN;

export function agreement(voter: number, candidate: number): number {
  return 1 - Math.abs(voter - candidate) / SPAN;
}

export function matchCandidate(
  candidateId: string,
  stances: Readonly<Record<string, number | null>>,
  issueIds: readonly string[],
  answers: Answers,
  overrides: Overrides = {},
): CandidateMatch {
  const own = overrides[candidateId] ?? {};
  const issues = issueIds.map((issueId): IssueMatch => {
    const answer = answers[issueId];
    const overridden = Object.hasOwn(own, issueId);
    const candidate = overridden ? own[issueId] : stances[issueId] ?? null;
    const voter = answer?.stance ?? null;
    const weight = voter === null ? 0 : answer.weight;
    return {
      issueId,
      voter,
      candidate,
      weight,
      agreement: voter === null || candidate === null ? null : agreement(voter, candidate),
      overridden,
    };
  });

  const answeredWeight = issues.reduce((sum, i) => sum + i.weight, 0);
  const known = issues.filter((i) => i.agreement !== null);
  const knownWeight = known.reduce((sum, i) => sum + i.weight, 0);
  const score = knownWeight === 0 ? null : Math.round((100 * known.reduce((s, i) => s + i.weight * (i.agreement ?? 0), 0)) / knownWeight);
  return { candidateId, score, coverage: answeredWeight === 0 ? 0 : knownWeight / answeredWeight, issues };
}

/** The voter's own answers win issue by issue; interview-derived answers fill the rest. */
export function effectiveAnswers(own: Answers, suggested: Readonly<Record<string, { stance: number | null; weight: 1 | 2 | 3 }>> | null): Answers {
  const fromInterview = Object.fromEntries(Object.entries(suggested ?? {}).map(([id, s]) => [id, { stance: s.stance, weight: s.weight }]));
  return { ...fromInterview, ...own };
}

export type MatchPick = { candidateId: string; name: string; score: number };

export type MatchHeadline = {
  /** The closest candidates, one per seat the contest fills. */
  picks: MatchPick[];
  /** The closest candidate who didn't make the picks. */
  runnerUpScore: number | null;
  runnerUpName: string | null;
  /** The last pick and the runner-up are within this many points, so the page says "too close to call". */
  closeCall: boolean;
  /** The lowest coverage among the picks. */
  coverage: number;
};

export const CLOSE_CALL_POINTS = 5;

/** The closest candidates on the voter's answers, as many as there are seats, or null when nothing can be compared. */
export function headlineMatch(
  candidates: readonly { id: string; name: string }[],
  stancesByCandidate: Readonly<Record<string, Readonly<Record<string, number | null>>>>,
  issueIds: readonly string[],
  answers: Answers,
  overrides: Overrides = {},
  seats = 1,
): MatchHeadline | null {
  const scored = candidates
    .filter((c) => stancesByCandidate[c.id])
    .map((c) => ({ c, m: matchCandidate(c.id, stancesByCandidate[c.id], issueIds, answers, overrides) }))
    .filter((x) => x.m.score !== null)
    .sort((a, b) => b.m.score! - a.m.score!);
  if (scored.length === 0) return null;
  const top = scored.slice(0, seats);
  const last = top[top.length - 1];
  const next = scored[top.length];
  return {
    picks: top.map(({ c, m }) => ({ candidateId: c.id, name: c.name, score: m.score! })),
    runnerUpScore: next?.m.score ?? null,
    runnerUpName: next?.c.name ?? null,
    closeCall: next !== undefined && last.m.score! - next.m.score! < CLOSE_CALL_POINTS,
    coverage: Math.min(...top.map((x) => x.m.coverage)),
  };
}

/** "Ann", "Ann and Bob", "Ann, Bob and Cy". */
export function joinNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
