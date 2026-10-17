"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/client";
import { useAccount } from "./AccountProvider";

/** Pages a signed-in person can use before accepting: to read what they are agreeing to, or to delete their account instead. */
const OPEN_PATHS = ["/terms", "/privacy", "/account"];

/** Asks a signed-in person to accept the current Terms and Privacy Policy before using the app. */
export function TermsGate({ children }: { children: ReactNode }) {
  const { user, terms, refresh } = useAccount();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || terms === "accepted" || OPEN_PATHS.includes(pathname)) return children;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/terms", { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth wrap stack">
      <h1>Before you continue</h1>
      <p className="muted">
        Ballotwise now has a <Link href="/terms">Terms of Service</Link> and a <Link href="/privacy">Privacy Policy</Link>. They say what
        we collect, who it goes to, and that you can delete your account and everything in it at any time.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" type="button" onClick={accept} disabled={busy}>{busy ? "Saving…" : "I accept"}</button>
      <p className="hint">
        Don&apos;t accept? You can <Link href="/account">delete your account</Link> instead.
      </p>
    </div>
  );
}
