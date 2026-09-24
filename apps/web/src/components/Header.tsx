import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";

/**
 * Top bar shared by the library and reader pages — matches
 * design/01-reading.html's header. Only ever rendered behind
 * ../auth/RequireAuth, so `user` is always set here.
 */
export function Header({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header
      style={{
        height: 52,
        flexShrink: 0,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        padding: "0 18px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center" }} aria-label="Paper X-Ray library">
          <Logo />
        </Link>
        {left}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        {right}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={user.displayName} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{user.displayName}</span>
          <button
            onClick={logout}
            style={{
              height: 30,
              padding: "0 11px",
              fontSize: 11,
              border: "1px solid var(--border-strong)",
              borderRadius: 3,
              background: "var(--surface)",
              color: "var(--text)",
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
