"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import { useAccount } from "./AccountProvider";

type Provider = "grok" | "codex";
const LABEL: Record<Provider, string> = { grok: "Grok", codex: "ChatGPT" };

/**
 * Grok's and ChatGPT's sign-ins show a code (or land on a localhost page) instead of returning to this site,
 * so the person pastes what they were shown. Grok is the default and recommended choice.
 */
export function GrokConnect() {
  const { grok, provider: connected, refresh } = useAccount();
  const [provider, setProvider] = useState<Provider>(connected ?? "grok");
  const [opened, setOpened] = useState(false);
  const [callback, setCallback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = LABEL[provider];

  function choose(next: Provider) {
    if (next === provider) return;
    setProvider(next);
    setOpened(false);
    setCallback("");
    setError(null);
  }

  async function open() {
    setError(null);
    // Open the tab synchronously so pop-up blockers allow it, then point it at the provider's sign-in.
    const tab = window.open("about:blank", "_blank");
    try {
      const { authorizeUrl } = await api<{ authorizeUrl: string }>("/api/auth/grok/start", { body: { provider } });
      if (tab) tab.location.href = authorizeUrl;
      else window.location.href = authorizeUrl;
      setOpened(true);
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : `Couldn't start ${name} sign-in.`);
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
      setError(err instanceof ApiError ? err.message : `Couldn't connect ${name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel connect">
      <h2>{grok === "refresh-failed" ? `Reconnect your ${name} account` : "Connect an AI account"}</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Ballotwise uses AI to search the web for you, on your own account. We never see your password, and we keep the
        connection encrypted.
      </p>
      <div className="chips" role="group" aria-label="AI account">
        <button type="button" className="chip" aria-pressed={provider === "grok"} onClick={() => choose("grok")}>Grok (recommended)</button>
        <button type="button" className="chip" aria-pressed={provider === "codex"} onClick={() => choose("codex")}>ChatGPT</button>
      </div>
      {provider === "codex" && (
        <p className="small muted" style={{ marginTop: 8 }}>
          ChatGPT is more likely to lean liberal in how it describes candidates and issues, so we recommend Grok.
        </p>
      )}
      <ol>
        <li>
          <button type="button" className="btn quiet" onClick={open}>Open {name} sign-in</button> and allow access.
        </li>
        <li>You&apos;ll see a code, or a page that won&apos;t load. Copy the code, or copy the whole web address of that page.</li>
        <li>Paste it below.</li>
      </ol>
      <form className="row" onSubmit={complete}>
        <label htmlFor="grok-code" className="sr-only" style={{ position: "absolute", left: -9999 }}>Code from {name}</label>
        <input
          id="grok-code"
          className="input"
          placeholder={opened ? "Paste the code or address here" : `Code from ${name}`}
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
