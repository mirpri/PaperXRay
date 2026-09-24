import type { ReactNode } from "react";
import { loginUrl } from "../api";
import { Logo } from "../components/Logo";
import { useAuth } from "./AuthContext";

/**
 * Gates the whole app behind SSO login — no library, no reader, nothing
 * except this screen until there's a valid session. SSO here provides
 * identity only (docs/02-decisions.md #4/#11); there's no separate
 * "browse without an account" mode.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ minHeight: "100svh", background: "var(--bg)" }} />;
  }

  if (!user) {
    return (
      <div
        style={{
          minHeight: "100svh",
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 340,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
            textAlign: "center",
          }}
        >
          <Logo size={40} />
          <div>
            <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>
              Paper X-Ray
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              Sign in with SSO to continue.
            </p>
          </div>
          <a
            href={loginUrl()}
            style={{
              width: "100%",
              height: 38,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 500,
              color: "#FFFFFF",
              background: "var(--text)",
              borderRadius: 3,
            }}
          >
            Log in with mirpass
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
