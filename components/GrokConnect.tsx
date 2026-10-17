"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import { useAccount } from "./AccountProvider";

/**
 * Grok's sign-in shows a code (or lands on a localhost page) instead of returning to this site,
 * so the person pastes what Grok showed them.
 */
export function GrokConnect() {
  const { grok, refresh } = useAccount();
  const [opened, setOpened] = useState(false);
  const [callback, setCallback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setError(null);
    // Open the tab synchronously so pop-up blockers allow it, then point it at Grok.
    const tab = window.open("about:blank", "_blank");
    try {
      const { authorizeUrl } = await api<{ authorizeUrl: string }>("/api/auth/grok/start", { method: "POST" });
      if (tab) tab.location.href = authorizeUrl;
      else window.location.href = authorizeUrl;
      setOpened(true);
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : "Couldn't start Grok sign-in.");
    }
  }

  async function complete(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/grok/complete", { body: { callback } });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't connect Grok.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel connect">
      <h2>{grok === "refresh-failed" ? "Reconnect your Grok account" : "Connect your Grok account"}</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Ballotwise does its research with Grok&apos;s live web search, using your own Grok account. We never see your xAI password, and the connection is stored encrypted.
      </p>
      <ol>
        <li>
          <button type="button" className="btn quiet" onClick={open}>Open Grok sign-in</button> and approve access.
        </li>
        <li>Grok shows a code, or a page that won&apos;t load. Copy the code, or the whole address from that page.</li>
        <li>Paste it here.</li>
      </ol>
      <form className="row" onSubmit={complete}>
        <label htmlFor="grok-code" className="sr-only" style={{ position: "absolute", left: -9999 }}>Code from Grok</label>
        <input
          id="grok-code"
          className="input"
          placeholder={opened ? "Paste the code or address here" : "Code from Grok"}
          value={callback}
          onChange={(e) => setCallback(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={busy || !callback.trim()}>{busy ? "Connecting…" : "Connect"}</button>
      </form>
      {error && <p className="error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
