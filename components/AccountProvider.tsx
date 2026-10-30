"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";

type Grok = "connected" | "disconnected" | "refresh-failed";
type Values = "none" | "in-progress" | "done";
type Terms = "accepted" | "needed";
type Provider = "grok" | "codex";
type Me = { user: { id: string; email: string } | null; grok: Grok; provider: Provider | null; values: Values; terms: Terms };
type Account = Me & { loading: boolean; refresh: () => Promise<void> };

const SIGNED_OUT: Me = { user: null, grok: "disconnected", provider: null, values: "none", terms: "accepted" };
const AccountContext = createContext<Account>({ ...SIGNED_OUT, loading: true, refresh: async () => {} });

// Starts as the layout script evaluates, before effects, so the header doesn't wait an extra turn to know who's signed in.
const boot: Promise<Me> | null = typeof window === "undefined" ? null : api<Me>("/api/account/me").catch(() => SIGNED_OUT);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>(SIGNED_OUT);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("/api/account/me"));
    } catch {
      setMe(SIGNED_OUT);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    (boot ?? api<Me>("/api/account/me").catch(() => SIGNED_OUT)).then((next) => {
      if (live) setMe(next);
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  return <AccountContext.Provider value={{ ...me, loading, refresh }}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);
