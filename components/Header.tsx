"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { useAccount } from "./AccountProvider";

export function Header() {
  const { user, loading, refresh } = useAccount();
  const router = useRouter();

  async function signOut() {
    await api("/api/account/signout", { method: "POST" }).catch(() => {});
    await refresh();
    router.push("/");
  }

  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="Ballotwise home">
          <span className="brand-mark" aria-hidden />
          Ballotwise
        </Link>
        {/* Pages can put their own section tabs here (the midterms tracker does, on wide screens). */}
        <div id="header-slot" className="header-slot" />
        <nav className="nav" aria-label="Main">
          <Link href="/midterms">Midterms</Link>
          <Link href="/method" className="wide-only">How it works</Link>
          {loading ? null : user ? (
            <>
            <Link href="/ballot">My ballot</Link>
            <button type="button" className="btn quiet" onClick={signOut}>
              Sign out
            </button>
            </>
          ) : (
            <>
              <Link href="/signin">Sign in</Link>
              <Link href="/signup" className="btn">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
