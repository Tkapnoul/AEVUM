import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, post } from "./api";
import { isNative, setToken } from "./native";
import type { Role } from "../../shared/metrics";
import type { Locale } from "../../shared/company";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  locale: Locale;
  birth_date: string | null;
  sex: string | null;
  height_cm: number | null;
  goals: string[];
  plan: string | null;
  created_at: number;
  is_admin: number;
}

interface Session {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("/auth/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await post("/auth/logout").catch(() => undefined);
    if (isNative) await setToken(null);
    // Health data cached for offline use must not outlive the session.
    if ("caches" in window) await caches.delete("aevum-data").catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
