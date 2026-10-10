import type { ReactNode } from "react";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { LogOut, User } from "lucide-react";
import { useNotifications } from "../NotificationContext";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { ACCOUNT_MANAGEMENT_URL_CHANGED, fetchAccountManagementUrl } from "../api";

/**
 * Top bar shared by the library and reader pages — matches
 * design/01-reading.html's header. Only ever rendered behind
 * ../auth/RequireAuth, so `user` is always set here.
 */
export function Header({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [accountUrl, setAccountUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const accountRequest = useRef(0);

  // Re-read when opening the menu so changes by another admin take effect too.
  useEffect(() => {
    const request = ++accountRequest.current;
    if (!user) { setAccountUrl(null); return; }
    fetchAccountManagementUrl().then(url => {
      if (request === accountRequest.current) setAccountUrl(url);
    }).catch(() => {
      if (request === accountRequest.current) setAccountUrl(null);
    });
    return () => { accountRequest.current++; };
  }, [user?.id, showUserMenu]);

  useEffect(() => {
    function updated(event: Event) {
      accountRequest.current++;
      setAccountUrl((event as CustomEvent<string | null>).detail);
    }
    window.addEventListener(ACCOUNT_MANAGEMENT_URL_CHANGED, updated);
    return () => window.removeEventListener(ACCOUNT_MANAGEMENT_URL_CHANGED, updated);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }

    if (showUserMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showUserMenu]);

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
        <nav style={{ display: "flex", gap: 14, fontSize: 12 }}>
          <Link to="/messages" className="pxr-messages-link" aria-label={unreadCount ? `Messages, ${unreadCount} unread` : "Messages"}>
            Messages
            {unreadCount > 0 && <><span className="pxr-unread-dot" aria-hidden="true" /><span className="mono pxr-unread-count" aria-hidden="true">{unreadCount}</span></>}
          </Link>
          <Link to="/lenses">Lenses</Link>
          <Link to="/admin">{user.role === "admin" ? "Admin" : "Settings"}</Link>
        </nav>
        <div ref={menuRef} style={{ position: "relative" }}>
          <div
            onClick={() => setShowUserMenu(!showUserMenu)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 4,
            }}
          >
            <Avatar name={user.displayName} />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{user.displayName}</span>
          </div>

          {showUserMenu && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                background: "var(--panel)",
                border: "1px solid var(--border-strong)",
                borderRadius: 4,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                minWidth: 160,
                zIndex: 1000,
                overflow: "hidden",
              }}
            >
              {accountUrl && (
                <a
                  href={accountUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowUserMenu(false)}
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    fontSize: 13,
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    color: "var(--text)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    textDecoration: "none",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <User size={15} strokeWidth={1.75} aria-hidden="true" />
                  Manage Account
                </a>
              )}
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  fontSize: 13,
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
