"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import type { Ballot } from "@/lib/ballot/store";
import type { GuideSummary } from "@/lib/guides";
import { useAccount } from "./AccountProvider";
import { GrokConnect } from "./GrokConnect";

type State = { ballot: Ballot | null; guides: GuideSummary[] };
const POLL_MS = 8000;

const STATUS_TEXT: Record<GuideSummary["status"], string> = {
  queued: "Waiting to be researched",
  researching: "Researching",
  ready: "Ready",
  failed: "Research failed",
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
        <label htmlFor="address">Where you&apos;re registered to vote</label>
        <input id="address" className="input" autoComplete="street-address" placeholder="Street address, city, state" value={address} onChange={(e) => setAddress(e.target.value)} />
        <span className="hint">
          Used to find your districts through the US Census geocoder and to look up your contests. It&apos;s stored with your account and never shown to anyone else.
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

export function BallotView() {
  const router = useRouter();
  const { user, loading, grok } = useAccount();
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

  const working = state?.ballot?.status === "finding" || state?.guides.some((g) => g.status === "queued" || g.status === "researching");
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
              Add your address and Ballotwise finds every contest on your ballot for the next year, then researches each one in
              the background. You can close this page while it works.
            </p>
          )}
          <AddressForm initial={ballot?.address ?? ""} onSaved={(s) => { setState(s); setEditing(false); }} onCancel={ballot ? () => setEditing(false) : undefined} />
        </div>
      )}

      {ballot && !editing && (
        <>
          <div className="ballot-status" aria-live="polite">
            {ballot.status === "finding" ? (
              <p className="progress-row"><span className="spinner" aria-hidden /><span>Finding the contests on your ballot. This takes a minute or two.</span></p>
            ) : ballot.status === "failed" ? (
              <p className="error">{ballot.error ?? "Couldn't find your contests."} <button type="button" className="btn quiet" onClick={refresh}>Try again</button></p>
            ) : (
              <p className="small muted">
                {guides.length === 0 ? "No contests with filed candidates were found for the next 12 months." : `${open.length} to go, ${voted.length} voted.`}{" "}
                <button type="button" className="btn quiet" onClick={refresh}>Check for new contests</button>
              </p>
            )}
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
                <ul className="contest-list">
                  {items.map((g) => (
                    <li key={g.id} className="contest">
                      <button type="button" className="oval voter" aria-label={`Mark ${g.title} as voted`} title="Mark as voted" onClick={() => setVoted(g.id, true)} />
                      <div className="contest-main">
                        <Link href={`/guide/${g.id}`} className="contest-title">{g.title}</Link>
                        <span className={`contest-status ${g.status}`}>
                          {(g.status === "queued" || g.status === "researching") && <span className="spinner small-spinner" aria-hidden />}
                          {g.status === "failed" ? g.error ?? STATUS_TEXT.failed : STATUS_TEXT[g.status]}
                        </span>
                      </div>
                      {g.status === "failed" ? (
                        <button type="button" className="btn secondary" onClick={() => retry(g.id)}>Try again</button>
                      ) : g.status === "ready" ? (
                        <Link href={`/guide/${g.id}`} className="btn secondary">Open guide</Link>
                      ) : null}
                    </li>
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
                <ul className="contest-list">
                  {voted.map((g) => (
                    <li key={g.id} className="contest done">
                      <button type="button" className="oval voter filled" aria-label={`Unmark ${g.title} as voted`} title="Unmark as voted" onClick={() => setVoted(g.id, false)} />
                      <div className="contest-main">
                        <Link href={`/guide/${g.id}`} className="contest-title">{g.title}</Link>
                        <span className="contest-status">{formatDate(g.electionDate)}</span>
                      </div>
                    </li>
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
