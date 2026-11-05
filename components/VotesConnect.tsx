"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import { RESULTS_SOURCE_LABEL, RESULTS_SOURCES, type ResultsSource } from "@/lib/ddhq/source";
import { useAccount } from "./AccountProvider";

const SOURCE_HINT: Record<ResultsSource, string> = {
  auto: "Decision Desk HQ's count and calls, with civicAPI's count in a race or county where it's recent and has more votes in.",
  ddhq: "Decision Desk HQ's count and calls everywhere, even where civicAPI has more votes in.",
  civic: "civicAPI's count and calls. Decision Desk HQ's forecast still shows.",
};

/** Turn Decision Desk HQ on with an emailed code, or off again, and pick where results come from. The code is not kept. */
export function VotesConnect() {
  const { user, loading, ddhq, ddhqSource, refresh } = useAccount();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading || !user) return null;

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/ddhq", { body: { email } });
      setSent(true);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't email a code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/ddhq", { body: { code } });
      setSent(false);
      setCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't connect Votes.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/ddhq", { method: "DELETE" });
      setSent(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't turn Decision Desk HQ off.");
    } finally {
      setBusy(false);
    }
  }

  async function pickSource(source: ResultsSource) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/ddhq", { method: "PATCH", body: { source } });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change where results come from.");
    } finally {
      setBusy(false);
    }
  }

  if (ddhq === "connected") {
    const source = ddhqSource ?? "auto";
    return (
      <section className="panel" style={{ marginTop: 28 }}>
        <h2>Decision Desk HQ</h2>
        <p className="muted">On for this account. Other people still see Ballotwise. You can turn this off anytime.</p>
        <div className="field">
          <span id="results-source" className="source-pick-label">Results from</span>
          <div className="source-pick" role="group" aria-labelledby="results-source">
            {RESULTS_SOURCES.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={source === s} disabled={busy} onClick={() => void pickSource(s)}>
                {RESULTS_SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
          <p className="muted small">{SOURCE_HINT[source]}</p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="btn quiet" disabled={busy} onClick={disconnect}>Turn off Decision Desk HQ</button>
      </section>
    );
  }

  if (sent) {
    return (
      <form className="panel" style={{ marginTop: 28 }} onSubmit={confirm} noValidate>
        <h2>Decision Desk HQ</h2>
        <p className="muted">Enter the code Votes emailed to {email}.</p>
        <div className="field">
          <label htmlFor="votes-code">Email code</label>
          <input id="votes-code" className="input" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Turn on Decision Desk HQ"}</button>
        <button type="button" className="btn quiet" disabled={busy} onClick={() => { setSent(false); setError(null); }}>Use a different email</button>
      </form>
    );
  }

  return (
    <form className="panel" style={{ marginTop: 28 }} onSubmit={send} noValidate>
      <h2>Decision Desk HQ</h2>
      <p className="muted">
        Turn this on to use your Votes Pro account for results and race calls. Votes emails you a code. Other people keep Ballotwise&apos;s numbers, and you can turn it off anytime.
      </p>
      <div className="field">
        <label htmlFor="votes-email">Votes email</label>
        <input id="votes-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
    </form>
  );
}
