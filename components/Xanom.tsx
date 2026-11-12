"use client";

import { useSearchParams } from "next/navigation";
import { useAccount } from "./AccountProvider";

const ERRORS: Record<string, string> = {
  cancelled: "Sign-in with Xanom was cancelled.",
  expired: "That sign-in took too long. Try again.",
  state: "That sign-in didn't match this browser. Try again.",
  unavailable: "Sign-in with Xanom isn't available right now. Use your email and password.",
  "linked-elsewhere": "That Xanom account is already linked to a different Ballotwise account.",
  "already-linked": "This Ballotwise account is already linked to a different Xanom account.",
  "email-mismatch": "That Xanom account uses a different email. Use “Link an existing Xanom account” instead.",
  "signed-out": "Your session ended. Sign in and try again.",
  failed: "Sign-in with Xanom didn't finish. Try again.",
};

export function xanomStartUrl(intent: "signin" | "link" | "convert", returnTo?: string | null): string {
  const q = new URLSearchParams({ intent });
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) q.set("return", returnTo);
  return `/api/xanom/start?${q}`;
}

/** The message for a `?xanom_error=` the callback sent back, if any. */
export function XanomError() {
  const code = useSearchParams().get("xanom_error");
  if (!code) return null;
  return <p className="error" role="alert">{ERRORS[code] ?? ERRORS.failed}</p>;
}

/** "Continue with Xanom", the main way in on the sign-in and sign-up screens. */
export function ContinueWithXanom({ next }: { next: string | null }) {
  return (
    <div className="xanom-start">
      <XanomError />
      {/* A plain link: the start route redirects to accounts.xanom.co. */}
      <a className="btn" href={xanomStartUrl("signin", next)}>Continue with Xanom</a>
      <p className="hint">One account for Ballotwise and the other Xanom apps.</p>
      <div className="or" role="separator"><span>or use your email</span></div>
    </div>
  );
}

/** The Xanom part of the account page: linked state, or convert and link. */
export function XanomAccount() {
  const { user, xanom } = useAccount();
  const params = useSearchParams();
  if (!user) return null;
  if (xanom) {
    return (
      <section className="xanom-account">
        <h2>Xanom account</h2>
        {params.get("xanom") === "linked" && <p className="notice" role="status">Your Xanom account is linked.</p>}
        <p>Signed in with Xanom · {xanom.email}</p>
        <a className="btn quiet" href="https://accounts.xanom.co/" target="_blank" rel="noopener">Manage at accounts.xanom.co</a>
      </section>
    );
  }
  return (
    <section className="xanom-account">
      <h2>Xanom account</h2>
      <p className="muted">Use one account for Ballotwise and the other Xanom apps. Your email and password keep working.</p>
      <XanomError />
      <div className="actions">
        <a className="btn" href={xanomStartUrl("convert", "/account")}>Convert to Xanom account</a>
        <a className="btn secondary" href={xanomStartUrl("link", "/account")}>Link an existing Xanom account</a>
      </div>
    </section>
  );
}
