"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import type { TranscriptEntry, ValuesState } from "@/lib/values";
import { useAccount } from "./AccountProvider";
import { GrokConnect } from "./GrokConnect";

type View = ValuesState & { asked: number; maxQuestions: number };
const WEIGHT_LABEL = { 1: "Matters a little", 2: "Matters", 3: "Matters a lot" } as const;

export function ValuesInterview() {
  const router = useRouter();
  const { user, loading, grok, refresh } = useAccount();
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const send = useCallback(
    async (body: { action: "start" | "finish" | "restart" } | { action: "answer"; text: string }) => {
      setBusy(true);
      setError(null);
      if (body.action === "answer") {
        // Show the answer right away while Grok thinks of the next question.
        setView((v) => (v ? { ...v, transcript: [...v.transcript, { role: "voter", text: body.text }] } : v));
        setDraft("");
      }
      try {
        const next = await api<View>("/api/values", { body });
        setView(next);
        if (next.summary) void refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
        if (body.action === "answer") {
          setView((v) => (v ? { ...v, transcript: v.transcript.slice(0, -1) } : v));
          setDraft(body.text);
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/signin?next=/interview");
      return;
    }
    api<View>("/api/values").then(setView).catch(() => setError("Couldn't load your interview."));
  }, [loading, user, router]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [view?.transcript.length, busy]);

  if (loading || (!view && !error)) return <div className="wrap"><p className="muted">Loading…</p></div>;
  if (grok !== "connected") return <div className="wrap read stack"><h1>Your values interview</h1><GrokConnect /></div>;
  if (!view) return <div className="wrap"><p className="error">{error}</p></div>;

  if (view.summary) {
    const s = view.summary;
    return (
      <div className="wrap read interview-done">
        <h1>What you told us</h1>
        <p className="lede-sm">{s.overview}</p>
        <section>
          <h2>Your priorities</h2>
          <ul className="priorities">
            {[...s.priorities].sort((a, b) => b.weight - a.weight).map((p) => (
              <li key={p.topic}>
                <div className="priority-head">
                  <span className="priority-topic">{p.topic}</span>
                  <span className={`weight w${p.weight}`}>{WEIGHT_LABEL[p.weight]}</span>
                </div>
                <p>{p.view}</p>
                {p.quote && <blockquote>“{p.quote}”</blockquote>}
              </li>
            ))}
          </ul>
        </section>
        {s.dealbreakers.length > 0 && (
          <section>
            <h2>Dealbreakers</h2>
            <ul>{s.dealbreakers.map((d) => <li key={d}>{d}</li>)}</ul>
          </section>
        )}
        {s.leadership && (
          <section>
            <h2>In a leader</h2>
            <p>{s.leadership}</p>
          </section>
        )}
        <div className="notice">
          Every contest on your ballot now shows your closest match from these answers. In any race you can change an answer, and that
          race uses yours instead.
        </div>
        <div className="row-gap">
          <Link href="/ballot" className="btn">See my matches</Link>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => confirm("Start the interview over? Your matches will update.") && send({ action: "restart" })}>
            Retake the interview
          </button>
        </div>
      </div>
    );
  }

  const started = view.transcript.length > 0;
  const last = [...view.transcript].reverse().find((e): e is Extract<TranscriptEntry, { role: "interviewer" }> => e.role === "interviewer");
  const percent = Math.round(Math.max(view.asked / view.maxQuestions, last?.progress ?? 0) * 100);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.trim() && !busy) void send({ action: "answer", text: draft.trim() });
  }

  if (!started) {
    return (
      <div className="wrap read stack interview-intro">
        <h1>Your values interview</h1>
        <p className="lede-sm">
          About ten minutes of plain questions about what you want from government: costs, housing, safety, schools, the environment,
          and what you look for in a leader. No parties, no candidate names.
        </p>
        <ul className="muted">
          <li>Answer in your own words or tap a suggested answer.</li>
          <li>Your answers are matched to every race on your ballot. Candidates are never shown to the AI while it maps your answers.</li>
          <li>You can stop early, and change any answer race by race.</li>
        </ul>
        {error && <p className="error">{error}</p>}
        <div><button type="button" className="btn" disabled={busy} onClick={() => send({ action: "start" })}>{busy ? "Starting…" : "Start the interview"}</button></div>
      </div>
    );
  }

  return (
    <div className="wrap read chat">
      <div className="chat-progress" aria-label="Interview progress">
        <div className="bp-head">
          <span className="small muted">Question {Math.min(view.asked, view.maxQuestions)} of about {view.maxQuestions}</span>
          <button type="button" className="btn quiet small" disabled={busy || view.asked < 3} onClick={() => send({ action: "finish" })}>
            Finish now
          </button>
        </div>
        <div className="bp-bar slim" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
      </div>

      <ol className="messages" aria-live="polite">
        {view.transcript.map((e, i) => (
          <li key={i} className={`msg ${e.role}`}>{e.text}</li>
        ))}
        {busy && <li className="msg interviewer typing" aria-label="Thinking"><span /><span /><span /></li>}
      </ol>
      <div ref={bottom} />

      {!busy && last && view.transcript.at(-1)?.role === "interviewer" && last.suggestions.length > 0 && (
        <div className="quick" aria-label="Suggested answers">
          {last.suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send({ action: "answer", text: s })}>{s}</button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <form className="composer" onSubmit={submit}>
        <label htmlFor="answer" style={{ position: "absolute", left: -9999 }}>Your answer</label>
        <textarea
          id="answer"
          className="input"
          rows={2}
          placeholder="Answer in your own words"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          disabled={busy}
        />
        <button className="btn" type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}
