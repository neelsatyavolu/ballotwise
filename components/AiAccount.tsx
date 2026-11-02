"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useAccount } from "./AccountProvider";
import { GrokConnect } from "./GrokConnect";

const LABEL = { grok: "Grok", codex: "ChatGPT" } as const;

/** The account page's AI section: connect Grok or ChatGPT, switch between them, or disconnect. */
export function AiAccount() {
  const { grok, provider, refresh } = useAccount();
  // The provider the switch was started from; once the other one connects, `provider` changes and the form closes.
  const [switchingFrom, setSwitchingFrom] = useState<typeof provider | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (grok !== "connected" || !provider) {
    return <div style={{ marginTop: 28 }}><GrokConnect /></div>;
  }

  const name = LABEL[provider];
  const other = provider === "grok" ? "codex" : "grok";

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/grok/logout", { method: "POST" });
      setSwitchingFrom(undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't disconnect ${name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: 28 }}>
      <h2>AI account</h2>
      <p className="muted">
        Connected to {name}. Research runs on your {name} account. Connecting {LABEL[other]} replaces this connection.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn quiet" disabled={busy} onClick={() => setSwitchingFrom(provider)}>
          Switch to {LABEL[other]}
        </button>
        <button type="button" className="btn quiet" disabled={busy} onClick={disconnect}>Disconnect {name}</button>
      </div>
      {switchingFrom === provider && <div style={{ marginTop: 16 }}><GrokConnect initial={other} /></div>}
    </section>
  );
}
