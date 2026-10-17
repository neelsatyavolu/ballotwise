"use client";

import { matchCandidate, type Answers, type Overrides } from "@/lib/match";
import type { CandidateRef, Issue, Profile } from "@/lib/schema";
import { describeStance, POINTS, Sources, StanceOvals } from "./bits";

type Props = {
  issues: Issue[];
  candidates: CandidateRef[];
  profiles: Record<string, Profile | undefined>;
  answers: Answers;
  notes?: Record<string, string>;
  overrides: Overrides;
  onOverride: (candidateId: string, issueId: string, stance: number | null | undefined) => void;
  onRetake: () => void;
};

const optionLabel = (p: number, issue: Issue) => (p === 0 ? "In between" : describeStance(p, issue.sideA, issue.sideB));

export function Results({ issues, candidates, profiles, answers, notes = {}, overrides, onOverride, onRetake }: Props) {
  const issueIds = issues.map((i) => i.id);
  const matches = candidates
    .filter((c) => profiles[c.id])
    .map((c) => {
      const stances = Object.fromEntries(profiles[c.id]!.positions.map((p) => [p.issueId, p.stance]));
      return { candidate: c, match: matchCandidate(c.id, stances, issueIds, answers, overrides) };
    })
    // Highest alignment first; candidates without enough data go last, in their shuffled order.
    .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1));

  const answered = issues.filter((i) => answers[i.id]?.stance != null).length;

  return (
    <div className="results">
      <div className="read stack">
        <p>
          This shows how much each candidate agrees with your {answered} answer{answered === 1 ? "" : "s"}, counting the issues you
          care about most more heavily. If we couldn&apos;t find where a candidate stands on an issue, that issue is left out of their
          score. This isn&apos;t advice on how to vote.
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
          <div style={{ overflowX: "auto" }}>
            <table className="breakdown">
              <thead>
                <tr><th>Issue</th><th>You</th><th>{candidate.name}</th><th>Fix it</th></tr>
              </thead>
              <tbody>
                {match.issues.map((row) => {
                  const issue = issues.find((i) => i.id === row.issueId)!;
                  const pos = profiles[candidate.id]!.positions.find((p) => p.issueId === row.issueId);
                  return (
                    <tr key={row.issueId}>
                      <td>{issue.title}</td>
                      <td>
                        <StanceOvals voter stance={row.voter} label={row.voter === null ? "Skipped" : describeStance(row.voter, issue.sideA, issue.sideB)} />
                        {notes[row.issueId] && <span className="from-interview" title={notes[row.issueId]}>From your interview</span>}
                      </td>
                      <td>
                        <StanceOvals stance={row.candidate} label={describeStance(row.candidate, issue.sideA, issue.sideB)} />{" "}
                        {row.overridden ? <span className="edited">Changed by you</span> : pos && <Sources urls={pos.sources} />}
                      </td>
                      <td>
                        <select
                          className="override-select"
                          aria-label={`Correct ${candidate.name}'s position on ${issue.title}`}
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
