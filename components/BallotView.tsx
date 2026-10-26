"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import type { Ballot } from "@/lib/ballot/store";
import { CATEGORIES, categoryOf, type Category } from "@/lib/categories";
import type { GuideSummary } from "@/lib/guides";
import { interviewMatchPhase } from "@/lib/match";
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

function MatchBlock({ guide, values, waitedMs, onRetry }: { guide: GuideSummary; values: string; waitedMs: number; onRetry: () => void }) {
  if (guide.kind === "judicial") return <p className="card-note">Judges aren&apos;t matched. See their record.</p>;
  const phase = interviewMatchPhase({
    hasMatch: Boolean(guide.match),
    fromInterview: guide.fromInterview,
    matchError: guide.matchError,
    values,
    waitedMs,
  });
  if (phase === "failed" || phase === "slow") {
    return (
      <div className="card-fail">
        <p className="card-note error">{phase === "failed" ? (guide.matchError ?? "Couldn't match your answers.") : "Matching is taking too long."}</p>
        <button type="button" className="btn quiet" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (phase === "matching") {
    return (
      <p className="card-note card-status">
        <span className="spinner small-spinner" aria-hidden />
        Matching your answers…
      </p>
    );
  }
  if (phase !== "ready" || !guide.match) {
    return <p className="card-note">{phase === "insufficient" ? "Not enough information to match" : "Take the interview to see your best match"}</p>;
  }
  const m = guide.match;
  const [first] = m.picks;
  if (m.picks.length > 1) {
    return (
      <div className="card-match">
        <span className="card-label">Best {m.picks.length} matches</span>
        {m.picks.map((p) => <span key={p.candidateId} className="card-close">{p.name}, {p.score}%</span>)}
        {m.closeCall && <span className="card-note">{m.runnerUpName} is close behind at {m.runnerUpScore}%</span>}
        {m.coverage < 0.5 && <span className="card-note">Based on little information</span>}
      </div>
    );
  }
  if (m.closeCall) {
    return (
      <div className="card-match">
        <span className="card-label">Too close to call</span>
        <span className="card-close">{first.name}, {first.score}%</span>
        <span className="card-close">{m.runnerUpName}, {m.runnerUpScore}%</span>
      </div>
    );
  }
  return (
    <div className="card-match">
      <span className="card-label">Best match</span>
      <span className="card-name">{first.name}</span>
      <span className="card-score">
        <span className="bar" aria-hidden><span style={{ width: `${first.score}%` }} /></span>
        <strong>{first.score}%</strong>
      </span>
      {m.coverage < 0.5 && <span className="card-note">Based on little information</span>}
    </div>
  );
}

function RaceCard({ guide: g, values, waitedMs, onVoted, onRetry, onMatchRetry }: { guide: GuideSummary; values: string; waitedMs: number; onVoted: (voted: boolean) => void; onRetry: () => void; onMatchRetry: () => void }) {
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
        <MatchBlock guide={g} values={values} waitedMs={waitedMs} onRetry={onMatchRetry} />
      ) : g.status === "failed" ? (
        <div className="card-fail">
          <p className="card-note error">{g.error ?? STATUS_TEXT.failed}</p>
          <button type="button" className="btn quiet" onClick={onRetry}>Try again</button>
        </div>
      ) : (
        <div className="card-working">
          <span className="card-status">
            <span className="spinner small-spinner" aria-hidden />
            {g.status === "researching" && g.candidateCount
              ? `${g.candidatesDone} of ${g.candidateCount} ${g.kind === "measure" ? "sides" : "candidates"} done`
              : g.status === "researching" && g.kind === "measure"
                ? "Looking up both sides"
                : STATUS_TEXT[g.status]}
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

/** A one-time offer, for a ballot found before judges were covered, to look for its judges alone. */
function JudgesOffer({ onFind, onDismiss }: { onFind: () => void; onDismiss: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className="offer" aria-labelledby="judges-offer-title" onCancel={onDismiss}>
      <h2 id="judges-offer-title">Judges are on your ballot too</h2>
      <p>
        Ballotwise now looks up the judges you vote on, including yes-or-no retention votes. Your ballot was built before that, so
        they&apos;re missing. We can look for just the judges. Your other races and answers stay as they are.
      </p>
      <div className="offer-actions">
        <button type="button" className="btn" onClick={onFind}>Find my judges</button>
        <button type="button" className="btn secondary" onClick={onDismiss}>Not now</button>
      </div>
    </dialog>
  );
}

export function BallotView() {
  const router = useRouter();
  const { user, loading, grok, values } = useAccount();
  const [state, setState] = useState<State | null>(null);
  const [editing, setEditing] = useState(false);
  const [showVoted, setShowVoted] = useState(false);
  const [tab, setTab] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchAttempt, setMatchAttempt] = useState<Record<string, number>>({});
  const [waitedById, setWaitedById] = useState<Record<string, number>>({});
  const matchStarts = useRef(new Map<string, { token: number; at: number }>());

  const load = useCallback(() => api<State>("/api/ballot").then(setState).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your ballot.")), []);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/signin?next=/ballot");
    else void load();
  }, [loading, user, router, load]);

  const needsMatch = (g: GuideSummary) =>
    values === "done" && g.status === "ready" && !g.match && !g.fromInterview && !g.matchError;
  const waitingIds = state?.guides.filter(needsMatch).map((g) => g.id) ?? [];
  const waitingKey = waitingIds.join(",");
  useEffect(() => {
    const ids = waitingKey ? waitingKey.split(",") : [];
    const now = Date.now();
    for (const id of [...matchStarts.current.keys()]) if (!ids.includes(id)) matchStarts.current.delete(id);
    for (const id of ids) {
      const token = matchAttempt[id] ?? 0;
      const prev = matchStarts.current.get(id);
      if (!prev || prev.token !== token) matchStarts.current.set(id, { token, at: now });
    }
    if (ids.length === 0) return;
    const timer = setInterval(() => {
      const t = Date.now();
      const elapsed: Record<string, number> = {};
      for (const id of ids) elapsed[id] = t - (matchStarts.current.get(id)?.at ?? t);
      setWaitedById(elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [waitingKey, matchAttempt]);
  const waitedMs = (id: string) => waitedById[id] ?? 0;

  const working =
    state?.ballot?.status === "finding" ||
    state?.guides.some((g) => g.status === "queued" || g.status === "researching") ||
    // After the interview, matches appear as each race is mapped.
    waitingIds.length > 0;
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

  async function findJudges() {
    setState((s) => (s?.ballot ? { ...s, ballot: { ...s.ballot, judgesChecked: true } } : s));
    await api("/api/ballot/judges", { method: "POST" }).catch(() => {});
    void load();
  }

  async function skipJudges() {
    setState((s) => (s?.ballot ? { ...s, ballot: { ...s.ballot, judgesChecked: true } } : s));
    await api("/api/ballot/judges", { method: "DELETE" }).catch(() => {});
  }

  async function retry(id: string) {
    await api(`/api/guides/${id}/retry`, { method: "POST" }).catch(() => {});
    void load();
  }

  async function retryMatch(id: string) {
    setMatchAttempt((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    setWaitedById((prev) => ({ ...prev, [id]: 0 }));
    await api(`/api/guides/${id}/retry`, { method: "POST", body: { kind: "match" } }).catch(() => {});
    void load();
  }

  if (loading || (!state && !error)) return <div className="wrap"><p className="muted">Loading your ballot…</p></div>;
  if (error || !state) return <div className="wrap"><p className="error">{error}</p></div>;

  const { ballot, guides } = state;
  const category = (g: GuideSummary) => categoryOf(g.kind, g.level);
  const tabs = CATEGORIES.filter((c) => guides.some((g) => category(g) === c.id));
  const activeTab = tabs.find((c) => c.id === tab)?.id ?? tabs[0]?.id;
  const shown = guides.filter((g) => category(g) === activeTab);
  const open = guides.filter((g) => !g.voted);
  const voted = guides.filter((g) => g.voted);
  const shownVoted = shown.filter((g) => g.voted);
  const byElection = new Map<string, GuideSummary[]>();
  for (const g of shown.filter((g) => !g.voted)) {
    // Grouped by date alone: the same election can come back under slightly different names.
    const key = g.electionDate ?? "";
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
          {ballot.status === "ready" && !ballot.judgesChecked && grok === "connected" && <JudgesOffer onFind={findJudges} onDismiss={skipJudges} />}
          <BallotProgress ballot={ballot} guides={guides} />
          <ValuesPrompt values={values} researching={ballot.status === "finding" || guides.some((g) => g.status !== "ready" && g.status !== "failed")} />
          <div className="ballot-status">
            {ballot.status === "failed" ? (
              <p className="error">{ballot.error ?? "We couldn't find your races."} <button type="button" className="btn quiet" onClick={refresh}>Try again</button></p>
            ) : ballot.status === "ready" ? (
              <p className="small muted">
                {guides.length === 0 ? "We didn't find any races or measures in the next 12 months." : `${open.length} left to vote on, ${voted.length} done.`}{" "}
                <button type="button" className="btn quiet" onClick={refresh}>Check for new races</button>
              </p>
            ) : null}
          </div>

          {tabs.length > 1 && (
            <div className="tabs" role="tablist" aria-label="Ballot sections">
              {tabs.map((c) => {
                const left = guides.filter((g) => category(g) === c.id && !g.voted).length;
                return (
                  <button key={c.id} type="button" role="tab" className="tab" aria-selected={activeTab === c.id} onClick={() => setTab(c.id)}>
                    {c.label}
                    {left > 0 && <span className="tab-count">{left}</span>}
                  </button>
                );
              })}
            </div>
          )}

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
                    <RaceCard key={g.id} guide={g} values={values} waitedMs={waitedMs(g.id)} onVoted={(v) => setVoted(g.id, v)} onRetry={() => retry(g.id)} onMatchRetry={() => retryMatch(g.id)} />
                  ))}
                </ul>
              </section>
            );
          })}

          {shownVoted.length > 0 && (
            <section className="election voted-section">
              <button type="button" className="btn quiet" aria-expanded={showVoted} onClick={() => setShowVoted(!showVoted)}>
                {showVoted ? "Hide" : "Show"} {shownVoted.length} voted
              </button>
              {showVoted && (
                <ul className="race-grid">
                  {shownVoted.map((g) => (
                    <RaceCard key={g.id} guide={g} values={values} waitedMs={waitedMs(g.id)} onVoted={(v) => setVoted(g.id, v)} onRetry={() => retry(g.id)} onMatchRetry={() => retryMatch(g.id)} />
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
