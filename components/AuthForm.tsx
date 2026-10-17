"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client";
import { useAccount } from "./AccountProvider";

type Mode = "signin" | "signup" | "forgot" | "reset";

const COPY: Record<Mode, { title: string; lede: string; button: string; busy: string }> = {
  signin: { title: "Sign in", lede: "Welcome back.", button: "Sign in", busy: "Signing in…" },
  signup: { title: "Create your account", lede: "Your races and answers are saved here, so you can come back any time before you vote.", button: "Create account", busy: "Creating account…" },
  forgot: { title: "Reset your password", lede: "Enter the email on your account and we'll send a link to set a new password.", button: "Send reset link", busy: "Sending…" },
  reset: { title: "Set a new password", lede: "This also signs you out on your other devices.", button: "Set password", busy: "Saving…" },
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[mode];
  const token = params.get("token") ?? "";
  const next = params.get("next");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        const res = await api<{ message: string }>("/api/account/forgot", { body: { email } });
        setSent(res.message);
        return;
      }
      const body = mode === "reset" ? { token, password } : { email, password };
      await api(`/api/account/${mode}`, { body });
      await refresh();
      router.push(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "reset" && !token) {
    return (
      <div className="auth wrap stack">
        <h1>Reset link missing</h1>
        <p className="muted">Open the link from your email again, or ask for a new one.</p>
        <Link href="/forgot" className="btn">Ask for a new link</Link>
      </div>
    );
  }

  return (
    <div className="auth wrap">
      <h1>{copy.title}</h1>
      <p className="muted">{copy.lede}</p>
      {sent ? (
        <p className="notice" style={{ marginTop: 24 }} role="status">{sent}</p>
      ) : (
        <form onSubmit={submit} noValidate>
          {mode !== "reset" && (
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          {mode !== "forgot" && (
            <div className="field">
              <label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={mode === "signin" ? 1 : 10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode !== "signin" && <span className="hint">At least 10 characters.</span>}
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? copy.busy : copy.button}</button>
        </form>
      )}
      <div className="links">
        {mode === "signin" && (<><Link href="/forgot">Forgot password?</Link><Link href="/signup">Create an account</Link></>)}
        {mode === "signup" && <Link href="/signin">Already have an account? Sign in</Link>}
        {(mode === "forgot" || mode === "reset") && <Link href="/signin">Back to sign in</Link>}
      </div>
    </div>
  );
}
