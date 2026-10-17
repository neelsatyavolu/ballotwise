"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";

type Grok = "connected" | "disconnected" | "refresh-failed";
type Values = "none" | "in-progress" | "done";
type Me = { user: { id: string; email: string } | null; grok: Grok; values: Values };
type Account = Me & { loading: boolean; refresh: () => Promise<void> };

const AccountContext = createContext<Account>({ user: null, grok: "disconnected", values: "none", loading: true, refresh: async () => {} });

export function AccountProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>({ user: null, grok: "disconnected", values: "none" });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("/api/account/me"));
    } catch {
      setMe({ user: null, grok: "disconnected", values: "none" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<Me>("/api/account/me")
      .then(setMe, () => setMe({ user: null, grok: "disconnected", values: "none" }))
      .finally(() => setLoading(false));
  }, []);

  return <AccountContext.Provider value={{ ...me, loading, refresh }}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);
