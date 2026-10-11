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
  const { user, loading, refresh, logout } = useAuth();

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

  if (user.status === "pending") {
    return <div style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 400, textAlign: "center" }}>
        <Logo size={40} />
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 22 }}>Awaiting approval</h1>
        <p style={{ color: "var(--text-muted)" }}>Your request to join has been sent to the administrators. You can enter once an administrator approves it.</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 20 }}>
          <button type="button" className="pxr-btn pxr-btn-primary" onClick={refresh}>Check approval</button>
          <button type="button" className="pxr-btn" onClick={() => void logout()}>Log out</button>
        </div>
      </div>
    </div>;
  }
  return <>{children}</>;
}
