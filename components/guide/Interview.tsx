"use client";

import { useState } from "react";
import type { Answer, Answers } from "@/lib/match";
import type { Issue } from "@/lib/schema";
import { POINTS } from "./bits";

const WEIGHTS: { value: Answer["weight"]; label: string }[] = [
  { value: 1, label: "A little" },
  { value: 2, label: "Somewhat" },
  { value: 3, label: "A lot" },
];

const POINT_LABEL: Record<number, string> = { [-2]: "Strongly the first", [-1]: "Lean the first", 0: "In between", 1: "Lean the second", 2: "Strongly the second" };

type Props = { issues: Issue[]; answers: Answers; notes?: Record<string, string>; onAnswer: (issueId: string, answer: Answer) => void; onFinish: () => void };

/** One issue at a time, in the race's order. Answers are never shown alongside candidates until the end. */
export function Interview({ issues, answers, notes = {}, onAnswer, onFinish }: Props) {
  const firstOpen = issues.findIndex((i) => !answers[i.id]);
  const [step, setStep] = useState(firstOpen === -1 ? 0 : firstOpen);
  const issue = issues[step];
  const answer = answers[issue.id] ?? { stance: null, weight: 2 as const };
  const last = step === issues.length - 1;

  return (
    <div className="interview">
      <p className="step-count">Question {step + 1} of {issues.length}</p>
      <h2 className="question">{issue.question}</h2>
      {notes[issue.id] && <p className="interview-note">From your values interview: {notes[issue.id]}</p>}
      <div className="answer-scale">
        <span className="side">{issue.sideA}</span>
        <div className="answer-ovals" role="radiogroup" aria-label="Your position">
          {POINTS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={answer.stance === p}
              aria-label={POINT_LABEL[p]}
              title={POINT_LABEL[p]}
              className={`oval voter${answer.stance === p ? " filled" : ""}`}
              onClick={() => onAnswer(issue.id, { ...answer, stance: p })}
            />
          ))}
        </div>
        <span className="side b">{issue.sideB}</span>
      </div>
      <div className="weights" role="group" aria-label="How much this matters to you">
        <span className="small muted">How much does this matter to you?</span>
        {WEIGHTS.map((w) => (
          <button key={w.value} type="button" className="chip" aria-pressed={answer.weight === w.value} onClick={() => onAnswer(issue.id, { ...answer, weight: w.value })}>
            {w.label}
          </button>
        ))}
      </div>
      <div className="step-nav">
        <button type="button" className="btn secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
        <div style={{ display: "flex", gap: 10 }}>
          {answer.stance === null && (
            <button type="button" className="btn secondary" onClick={() => { onAnswer(issue.id, { stance: null, weight: answer.weight }); if (last) onFinish(); else setStep(step + 1); }}>
              Skip
            </button>
          )}
          <button type="button" className="btn" disabled={answer.stance === null} onClick={() => (last ? onFinish() : setStep(step + 1))}>
            {last ? "See my match" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
