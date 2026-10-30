"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/client";
import { useAccount } from "./AccountProvider";

export function Header() {
  const { user, loading, refresh } = useAccount();
  const router = useRouter();
  const path = usePathname();

  // The catalog is what every tracker screen needs. Fetch it once the home page is idle so the click doesn't wait on it.
  useEffect(() => {
    if (path !== "/") return;
    const run = () => {
      void import("@/components/midterms/hooks").then((m) => m.warmLive(["/api/midterms", "/api/midterms/forecast"]));
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1200);
    return () => clearTimeout(id);
  }, [path]);

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
          <Link href="/midterms" className="section-link">Midterms</Link>
          <Link href="/method" className="wide-only section-link">How it works</Link>
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
