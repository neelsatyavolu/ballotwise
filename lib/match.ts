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
