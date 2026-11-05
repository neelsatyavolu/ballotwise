"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import { useAccount } from "./AccountProvider";
import { AiAccount } from "./AiAccount";
import { VotesConnect } from "./VotesConnect";

export function DeleteAccount() {
  const { user, loading, refresh } = useAccount();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!user) {
    return (
      <div className="auth wrap">
        <h1>Your account</h1>
        <p className="muted">Sign in to see your saved races, connect your accounts, or delete your account.</p>
        <div className="actions">
          <Link href="/signin?next=/account" className="btn">Sign in</Link>
        </div>
        <div className="links">
          <span>New here? <Link href="/signup">Create an account</Link></span>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/delete", { body: { password } });
      await refresh();
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth wrap">
      <h1>Your account</h1>
      <p className="muted">Signed in as {user.email}.</p>
      <AiAccount />
      <VotesConnect />
      <h2 style={{ marginTop: 32 }}>Delete your account</h2>
      <p>
        This permanently deletes your account, your address, your interview answers, your ballot and every guide, and turns off
        your Grok or ChatGPT connection and Decision Desk HQ. It can&apos;t be undone.
      </p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="password">Enter your password to confirm</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn danger" type="submit" disabled={busy || !password}>{busy ? "Deleting…" : "Delete my account"}</button>
      </form>
    </div>
  );
}
