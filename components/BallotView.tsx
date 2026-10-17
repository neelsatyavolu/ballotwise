"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import type { Ballot } from "@/lib/ballot/store";
import type { GuideSummary } from "@/lib/guides";
import { useAccount } from "./AccountProvider";
import { AddressInput } from "./AddressInput";
import { BallotProgress, contestProgress } from "./BallotProgress";
import { GrokConnect } from "./GrokConnect";

type State = { ballot: Ballot | null; guides: GuideSummary[] };
const POLL_MS = 8000;

const STATUS_TEXT: Record<GuideSummary["status"], string> = {
  queued: "In line",
  researching: "Looking up candidates",
  ready: "Ready",
  failed: "Couldn't finish",
};

function formatDate(date: string | null): string {
  if (!date) return "Date to be announced";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function daysUntil(date: string | null): string | null {
  if (!date) return null;
  const days = Math.round((new Date(`${date}T12:00:00`).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "Past";
  if (days === 0) return "Today";
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}

function AddressForm({ initial, onSaved, onCancel }: { initial: string; onSaved: (s: State) => void; onCancel?: () => void }) {
  const [address, setAddress] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/ballot", { method: "PUT", body: { address } });
      onSaved(await api<State>("/api/ballot"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="address">Your home address (where you&apos;re registered to vote)</label>
        <AddressInput id="address" value={address} onChange={setAddress} />
        <span className="hint">
          We use it to find your districts and the races on your ballot. It&apos;s saved to your account and no one else can see it.
        </span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn" type="submit" disabled={busy || address.trim().length < 8}>{busy ? "Finding your districts…" : "Find my ballot"}</button>
        {onCancel && <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function MatchBlock({ guide, values }: { guide: GuideSummary; values: string }) {
  const m = guide.match;
  if (!m) {
    const note =
      values !== "done" ? "Take the interview to see your best match" : !guide.fromInterview ? "Matching your answers…" : "Not enough information to match";
    return <p className="card-note">{note}</p>;
  }
  if (m.closeCall) {
    return (
      <div className="card-match">
        <span className="card-label">Too close to call</span>
        <span className="card-close">{m.name}, {m.score}%</span>
        <span className="card-close">{m.runnerUpName}, {m.runnerUpScore}%</span>
      </div>
    );
  }
  return (
    <div className="card-match">
      <span className="card-label">Best match</span>
      <span className="card-name">{m.name}</span>
      <span className="card-score">
        <span className="bar" aria-hidden><span style={{ width: `${m.score}%` }} /></span>
        <strong>{m.score}%</strong>
      </span>
      {m.coverage < 0.5 && <span className="card-note">Based on little information</span>}
    </div>
  );
}

function RaceCard({ guide: g, values, onVoted, onRetry }: { guide: GuideSummary; values: string; onVoted: (voted: boolean) => void; onRetry: () => void }) {
  const working = g.status === "queued" || g.status === "researching";
  return (
    <li className={`race-card ${g.status}${g.voted ? " done" : ""}`}>
      <div className="card-top">
        <Link href={`/guide/${g.id}`} className="card-title">{g.title}</Link>
        <button
          type="button"
          className={`oval voter${g.voted ? " filled" : ""}`}
          aria-label={g.voted ? `Unmark ${g.title} as voted` : `Mark ${g.title} as voted`}
          title={g.voted ? "Unmark as voted" : "Mark as voted"}
          onClick={() => onVoted(!g.voted)}
        />
      </div>
      {g.voted ? (
        <p className="card-note">Voted</p>
      ) : g.status === "ready" ? (
        <MatchBlock guide={g} values={values} />
      ) : g.status === "failed" ? (
        <div className="card-fail">
          <p className="card-note error">{g.error ?? STATUS_TEXT.failed}</p>
          <button type="button" className="btn quiet" onClick={onRetry}>Try again</button>
        </div>
      ) : (
        <div className="card-working">
          <span className="card-status">
            <span className="spinner small-spinner" aria-hidden />
            {g.status === "researching" && g.candidateCount ? `${g.candidatesDone} of ${g.candidateCount} candidates done` : STATUS_TEXT[g.status]}
          </span>
          {working && g.activity && <span className="contest-activity">{g.activity}</span>}
          <span className="mini-bar" aria-hidden><span style={{ width: `${Math.round(contestProgress(g) * 100)}%` }} /></span>
        </div>
      )}
    </li>
  );
}

function ValuesPrompt({ values, researching }: { values: string; researching: boolean }) {
  if (values === "done") {
    return (
      <p className="small muted values-done">
        Your matches come from your interview. <Link href="/interview">See or redo it</Link>
      </p>
    );
  }
  return (
    <section className="values-prompt">
      <span className="values-star" aria-hidden>★</span>
      <div>
        <h2>{values === "in-progress" ? "Finish your interview" : researching ? "While you wait: take a 10-minute interview" : "See your best match in every race"}</h2>
        <p>
          Answer some easy questions about what matters to you. We&apos;ll use them to show which candidate agrees with you most in
          every race on your ballot.
        </p>
      </div>
      <Link href="/interview" className="btn">{values === "in-progress" ? "Continue" : "Start the interview"}</Link>
    </section>
  );
}

export function BallotView() {
  const router = useRouter();
  const { user, loading, grok, values } = useAccount();
  const [state, setState] = useState<State | null>(null);
  const [editing, setEditing] = useState(false);
  const [showVoted, setShowVoted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<State>("/api/ballot").then(setState).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your ballot.")), []);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/signin?next=/ballot");
    else void load();
  }, [loading, user, router, load]);

  const working =
    state?.ballot?.status === "finding" ||
    state?.guides.some((g) => g.status === "queued" || g.status === "researching") ||
    // After the interview, matches appear as each race is mapped.
    (values === "done" && state?.guides.some((g) => g.status === "ready" && !g.fromInterview));
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [working, load]);

  async function setVoted(id: string, voted: boolean) {
    setState((s) => (s ? { ...s, guides: s.guides.map((g) => (g.id === id ? { ...g, voted } : g)) } : s));
    await api(`/api/guides/${id}`, { method: "PATCH", body: { voted } }).catch(() => load());
  }

  async function refresh() {
    await api("/api/ballot/refresh", { method: "POST" }).catch(() => {});
    void load();
  }

  async function retry(id: string) {
    await api(`/api/guides/${id}/retry`, { method: "POST" }).catch(() => {});
    void load();
  }

  if (loading || (!state && !error)) return <div className="wrap"><p className="muted">Loading your ballot…</p></div>;
  if (error || !state) return <div className="wrap"><p className="error">{error}</p></div>;

  const { ballot, guides } = state;
  const open = guides.filter((g) => !g.voted);
  const voted = guides.filter((g) => g.voted);
  const byElection = new Map<string, GuideSummary[]>();
  for (const g of open) {
    const key = `${g.electionDate ?? ""}|${g.electionName ?? ""}`;
    byElection.set(key, [...(byElection.get(key) ?? []), g]);
  }

  return (
    <div className="wrap">
      <header className="ballot-head">
        <h1>My ballot</h1>
        {ballot && !editing && (
          <p className="muted">
            For {ballot.address}.{" "}
            <button type="button" className="btn quiet" onClick={() => setEditing(true)}>Change address</button>
          </p>
        )}
      </header>

      {grok !== "connected" && <div style={{ margin: "24px 0" }}><GrokConnect /></div>}

      {(!ballot || editing) && grok === "connected" && (
        <div className="read" style={{ marginTop: 24 }}>
          {!ballot && (
            <p style={{ marginBottom: 16 }}>
              Add your address and we&apos;ll find every race on your ballot for the next year and look up each one. You can close
              this page while we work.
            </p>
          )}
          <AddressForm initial={ballot?.address ?? ""} onSaved={(s) => { setState(s); setEditing(false); }} onCancel={ballot ? () => setEditing(false) : undefined} />
        </div>
      )}

      {ballot && !editing && (
        <>
          <BallotProgress ballot={ballot} guides={guides} />
          <ValuesPrompt values={values} researching={ballot.status === "finding" || guides.some((g) => g.status !== "ready" && g.status !== "failed")} />
          <div className="ballot-status">
            {ballot.status === "failed" ? (
              <p className="error">{ballot.error ?? "We couldn't find your races."} <button type="button" className="btn quiet" onClick={refresh}>Try again</button></p>
            ) : ballot.status === "ready" ? (
              <p className="small muted">
                {guides.length === 0 ? "We didn't find any races with candidates in the next 12 months." : `${open.length} left to vote on, ${voted.length} done.`}{" "}
                <button type="button" className="btn quiet" onClick={refresh}>Check for new races</button>
              </p>
            ) : null}
          </div>

          {[...byElection.entries()].map(([key, items]) => {
            const { electionDate, electionName } = items[0];
            return (
              <section className="election" key={key}>
                <div className="election-head">
                  <h2>{electionName ?? "Election"}</h2>
                  <span className="muted">{formatDate(electionDate)}</span>
                  {daysUntil(electionDate) && <span className="countdown">{daysUntil(electionDate)}</span>}
                </div>
                <ul className="race-grid">
                  {items.map((g) => (
                    <RaceCard key={g.id} guide={g} values={values} onVoted={(v) => setVoted(g.id, v)} onRetry={() => retry(g.id)} />
                  ))}
                </ul>
              </section>
            );
          })}

          {voted.length > 0 && (
            <section className="election voted-section">
              <button type="button" className="btn quiet" aria-expanded={showVoted} onClick={() => setShowVoted(!showVoted)}>
                {showVoted ? "Hide" : "Show"} {voted.length} voted
              </button>
              {showVoted && (
                <ul className="race-grid">
                  {voted.map((g) => (
                    <RaceCard key={g.id} guide={g} values={values} onVoted={(v) => setVoted(g.id, v)} onRetry={() => retry(g.id)} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
