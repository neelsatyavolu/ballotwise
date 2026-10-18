import type { Answers } from "@/lib/match";
import { stanceOf, type CandidateRef, type Issue, type Profile } from "@/lib/schema";
import { describeStance, POINTS, Sources, StanceOvals } from "./bits";

type Props = { issues: Issue[]; candidates: CandidateRef[]; profiles: Record<string, Profile | undefined>; answers: Answers };

/** Beyond this many candidates, side-by-side columns get too narrow to read, so each issue becomes one shared scale. */
const MAX_COLUMNS = 4;

export function Compare(props: Props) {
  const answered = props.issues.some((i) => mineOn(props.answers, i) !== null);
  return (
    <>
      {answered && (
        <p className="compare-key">
          <span className="scale" aria-hidden><span className="oval mine" /></span> Red ring: your answer
        </p>
      )}
      {props.candidates.length > MAX_COLUMNS ? <Spectrum {...props} /> : <Columns {...props} />}
    </>
  );
}

const mineOn = (answers: Answers, issue: Issue) => answers[issue.id]?.stance ?? null;

function Columns({ issues, candidates, profiles, answers }: Props) {
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
          {candidates.map((c) => (
            <Cell key={c.id} candidate={c} issue={issue} profile={profiles[c.id]} mine={mineOn(answers, issue)} />
          ))}
        </div>
      ))}
    </div>
  );
}

const POINT_LABELS: Record<number, string> = { [-2]: "◀ Strongly", [-1]: "◀ Leans", 0: "In between", 1: "Leans ▶", 2: "Strongly ▶" };

/** One ballot scale per issue with every candidate's name placed on it; what they said opens below. */
function Spectrum({ issues, candidates, profiles, answers }: Props) {
  return (
    <div className="spectrum-list">
      {issues.map((issue) => {
        const position = (c: CandidateRef) => profiles[c.id]?.positions.find((p) => p.issueId === issue.id);
        const stance = (c: CandidateRef) => {
          const p = position(c);
          return p ? stanceOf(p) : null;
        };
        const pending = candidates.filter((c) => !profiles[c.id]);
        const unknown = candidates.filter((c) => profiles[c.id] && stance(c) === null);
        const mine = mineOn(answers, issue);
        return (
          <section className="spectrum-issue" key={issue.id}>
            <div className="issue-q">
              <h3>{issue.title}</h3>
              <p>{issue.question}</p>
            </div>
            <div className="spectrum-ends">
              <span><b>◀</b> {issue.sideA}</span>
              <span>{issue.sideB} <b>▶</b></span>
            </div>
            <ol className="spectrum">
              {POINTS.map((point) => {
                const here = candidates.filter((c) => profiles[c.id] && stance(c) === point);
                return (
                  <li key={point} className="spectrum-col">
                    <span className="spectrum-mark">
                      <span className={`oval${here.length > 0 ? " filled" : ""}${mine === point ? " mine" : ""}`} aria-hidden />
                      <span className="spectrum-label">{POINT_LABELS[point]}</span>
                    </span>
                    <ul aria-label={describeStance(point, issue.sideA, issue.sideB)}>
                      {mine === point && <li className="you">You</li>}
                      {here.map((c) => (
                        <li key={c.id}>
                          {c.name}
                          {position(c)?.stance === null && <span className="estimated-tag">Estimated</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
            {unknown.length > 0 && <p className="spectrum-note">No public position found: {unknown.map((c) => c.name).join(", ")}</p>}
            {pending.length > 0 && <p className="spectrum-note">Still looking up: {pending.map((c) => c.name).join(", ")}</p>}
            <details className="said">
              <summary>What each candidate said</summary>
              <div className="said-grid">
                {candidates.map((c) => (
                  <Cell key={c.id} candidate={c} issue={issue} profile={profiles[c.id]} mine={mine} named />
                ))}
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}

function Cell({ candidate, issue, profile, mine, named = false }: { candidate: CandidateRef; issue: Issue; profile: Profile | undefined; mine: number | null; named?: boolean }) {
  const pos = profile?.positions.find((p) => p.issueId === issue.id);
  return (
    <div className={`cell${named ? " named" : ""}`}>
      <span className="cell-name">{candidate.name}</span>
      {!profile ? (
        <span className="unknown">Looking up…</span>
      ) : pos && pos.stance === null && pos.estimate ? (
        <>
          <StanceOvals estimated mine={mine} stance={pos.estimate.stance} label={describeStance(pos.estimate.stance, issue.sideA, issue.sideB)} />
          <span className="estimated-note"><span className="estimated-tag">Estimated</span> {pos.estimate.basis}</span>
        </>
      ) : !pos || pos.stance === null ? (
        <>
          <StanceOvals mine={mine} stance={null} label="Unknown" />
          <span className="unknown">{pos?.summary ?? "We couldn't find where they stand on this."}</span>
          {pos && <Sources urls={pos.sources} />}
        </>
      ) : (
        <>
          <StanceOvals mine={mine} stance={pos.stance} label={describeStance(pos.stance, issue.sideA, issue.sideB)} />
          <span>
            {pos.summary} <Sources urls={pos.sources} />
          </span>
          {pos.quote && <blockquote>“{pos.quote}”</blockquote>}
        </>
      )}
    </div>
  );
}
