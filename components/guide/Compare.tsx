import type { CandidateRef, Issue, Profile } from "@/lib/schema";
import { describeStance, Sources, StanceOvals } from "./bits";

type Props = { issues: Issue[]; candidates: CandidateRef[]; profiles: Record<string, Profile | undefined> };

export function Compare({ issues, candidates, profiles }: Props) {
  const cols = { "--cols": candidates.length } as React.CSSProperties;
  return (
    <div className="compare" style={cols}>
      <div className="issue-row head" aria-hidden>
        <span className="muted small">Issue</span>
        {candidates.map((c) => (
          <span key={c.id} className="cand-name">{c.name}</span>
        ))}
      </div>
      {issues.map((issue) => (
        <div className="issue-row" key={issue.id}>
          <div className="issue-q">
            <h3>{issue.title}</h3>
            <p>{issue.question}</p>
            <div className="sides">
              <span><b>◀</b> {issue.sideA}</span>
              <span><b>▶</b> {issue.sideB}</span>
            </div>
          </div>
          {candidates.map((c) => {
            const profile = profiles[c.id];
            const pos = profile?.positions.find((p) => p.issueId === issue.id);
            return (
              <div className="cell" key={c.id}>
                <span className="cell-name">{c.name}</span>
                {!profile ? (
                  <span className="unknown">Looking up…</span>
                ) : !pos || pos.stance === null ? (
                  <>
                    <StanceOvals stance={null} label="Unknown" />
                    <span className="unknown">{pos?.summary ?? "We couldn't find where they stand on this."}</span>
                    {pos && <Sources urls={pos.sources} />}
                  </>
                ) : (
                  <>
                    <StanceOvals stance={pos.stance} label={describeStance(pos.stance, issue.sideA, issue.sideB)} />
                    <span>
                      {pos.summary} <Sources urls={pos.sources} />
                    </span>
                    {pos.quote && <blockquote>“{pos.quote}”</blockquote>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
