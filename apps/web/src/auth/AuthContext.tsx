import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@paper-xray/contracts";
import { fetchMe, logout as apiLogout } from "../api";

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Single source of truth for "who's logged in," shared by the header on every page instead of each page re-fetching /auth/me independently. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const deleted = () => setUser(null);
    window.addEventListener("pxr:account-deleted", deleted);
    return () => window.removeEventListener("pxr:account-deleted", deleted);
  }, []);

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
