"use client";

import { matchCandidate, type Answers, type Overrides } from "@/lib/match";
import { profileStances, type CandidateRef, type Issue, type Profile } from "@/lib/schema";
import { describeStance, POINTS, Sources, StanceOvals } from "./bits";

type Props = {
  issues: Issue[];
  candidates: CandidateRef[];
  profiles: Record<string, Profile | undefined>;
  answers: Answers;
  notes?: Record<string, { why: string; inferred: boolean }>;
  overrides: Overrides;
  onOverride: (candidateId: string, issueId: string, stance: number | null | undefined) => void;
  /** How many of the voter's answers on this race are inferred guesses they haven't confirmed. */
  guesses?: number;
  onCheckGuesses?: () => void;
  onRetake: () => void;
};

const optionLabel = (p: number, issue: Issue) => (p === 0 ? "In between" : describeStance(p, issue.sideA, issue.sideB));

export function Results({ issues, candidates, profiles, answers, notes = {}, overrides, onOverride, guesses = 0, onCheckGuesses, onRetake }: Props) {
  const issueIds = issues.map((i) => i.id);
  const matches = candidates
    .filter((c) => profiles[c.id])
    .map((c) => {
      const stances = profileStances(profiles[c.id]!);
      return { candidate: c, match: matchCandidate(c.id, stances, issueIds, answers, overrides) };
    })
    // Highest alignment first; candidates without enough data go last, in their shuffled order.
    .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1));

  const answered = issues.filter((i) => answers[i.id]?.stance != null).length;

  return (
    <div className="results">
      <div className="read stack">
        {guesses > 0 && onCheckGuesses && (
          <p className="notice">
            {guesses} of your answers on this race {guesses === 1 ? "is a guess" : "are guesses"} from your interview, which didn&apos;t ask about{" "}
            {guesses === 1 ? "it" : "them"} directly. Checking them makes your match more accurate.{" "}
            <button type="button" className="btn quiet" onClick={onCheckGuesses}>Check {guesses === 1 ? "it" : "them"}</button>
          </p>
        )}
        <p>
          This shows how much each candidate agrees with your {answered} answer{answered === 1 ? "" : "s"}, counting the issues you
          care about most more heavily. If we couldn&apos;t find where a candidate stands on an issue, we estimate it from their other
          positions and record and mark it as estimated; if even that isn&apos;t possible, the issue is left out of their score. This isn&apos;t advice on how to vote.
        </p>
        <p className="small muted">
          Think we got someone&apos;s position wrong? Fix it in the table and the score updates.{" "}
          <button type="button" className="btn quiet" onClick={onRetake}>Change my answers for this race</button>
        </p>
      </div>
      {matches.map(({ candidate, match }) => (
        <section className="result" key={candidate.id} aria-label={candidate.name}>
          <div className="result-head">
            <h3>{candidate.name}</h3>
            <span className="score">{match.score === null ? "—" : `${match.score}%`}</span>
          </div>
          <div className="bar" aria-hidden><span style={{ width: `${match.score ?? 0}%` }} /></div>
          <p className="small muted">
            {match.score === null
              ? "Not enough information on the issues you answered."
              : match.coverage >= 0.999 ? "Based on every issue you answered." : `Based on ${Math.round(match.coverage * 100)}% of what you said matters.`}
          </p>
          <div className="breakdown-wrap">
            <table className="breakdown">
              <colgroup>
                <col className="c-issue" />
                <col className="c-stance" />
                <col className="c-stance" />
                <col className="c-agree" />
                <col className="c-fix" />
              </colgroup>
              <thead>
                <tr><th>Issue</th><th>You</th><th>{candidate.name}</th><th className="num">Agree</th><th>Fix it</th></tr>
              </thead>
              <tbody>
                {match.issues.map((row) => {
                  const issue = issues.find((i) => i.id === row.issueId)!;
                  const pos = profiles[candidate.id]!.positions.find((p) => p.issueId === row.issueId);
                  return (
                    <tr key={row.issueId}>
                      <td className="issue-cell">{issue.title}</td>
                      <td data-label="You">
                        {row.voter === null ? (
                          <span className="cell-empty">Not answered</span>
                        ) : (
                          <StanceOvals voter stance={row.voter} label={describeStance(row.voter, issue.sideA, issue.sideB)} />
                        )}
                        {notes[row.issueId] && (
                          <span className="cell-sub" title={notes[row.issueId].why}>
                            {row.voter === null ? "Your interview didn’t cover this" : notes[row.issueId].inferred ? "Inferred from your interview" : "From your interview"} ⓘ
                          </span>
                        )}
                      </td>
                      <td data-label={candidate.name}>
                        {row.candidate === null ? (
                          <span className="cell-empty">Unknown</span>
                        ) : (
                          <StanceOvals
                            stance={row.candidate}
                            estimated={!row.overridden && pos?.stance === null}
                            label={describeStance(row.candidate, issue.sideA, issue.sideB)}
                          />
                        )}
                        {row.overridden ? (
                          <span className="cell-sub edited">Changed by you</span>
                        ) : pos?.stance === null && pos.estimate ? (
                          <span className="cell-sub" title={pos.estimate.basis}>Estimated ⓘ</span>
                        ) : (
                          pos && pos.sources.length > 0 && <span className="cell-sub">Sources <Sources compact urls={pos.sources} /></span>
                        )}
                      </td>
                      <td className="num agree" data-label="Agree">{row.agreement === null ? "—" : `${Math.round(row.agreement * 100)}%`}</td>
                      <td data-label="Fix it">
                        <select
                          className="override-select"
                          aria-label={`Fix ${candidate.name}'s position on ${issue.title}`}
                          value={row.overridden ? String(row.candidate) : "source"}
                          onChange={(e) => {
                            const v = e.target.value;
                            onOverride(candidate.id, row.issueId, v === "source" ? undefined : v === "null" ? null : Number(v));
                          }}
                        >
                          <option value="source">As we found it</option>
                          {POINTS.map((p) => <option key={p} value={p}>{optionLabel(p, issue)}</option>)}
                          <option value="null">Unknown</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
