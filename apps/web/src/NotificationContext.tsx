import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { fetchMe, fetchUnreadNotificationCount } from "./api";
import { useAuth } from "./auth/AuthContext";
const SOCKET_BASE = import.meta.env.VITE_SOCKET_BASE ?? "http://localhost:3001";
const NotificationContext = createContext<{ unreadCount: number; revision: number; refresh: () => Promise<void> } | null>(null);
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [revision, setRevision] = useState(0);
  const countRef = useRef(0);
  const requestRef = useRef(0);
  const userRef = useRef(user?.id); userRef.current = user?.id;
  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const request = ++requestRef.current;
    try {
      const count = await fetchUnreadNotificationCount();
      if (request !== requestRef.current || userRef.current !== user.id) return;
      if (count !== countRef.current) setRevision(value => value + 1);
      countRef.current = count; setUnreadCount(count);
    } catch { /* Keep the last known count through transient network failures. */ }
  }, [user?.id]);
  useEffect(() => {
    countRef.current = 0; setUnreadCount(0);
    if (!user?.id) return;
    const changed = () => { setRevision(value => value + 1); void refresh(); };
    const socket = io(SOCKET_BASE, { withCredentials: true });
    socket.on("notifications:changed", changed);
    socket.on("account:deleted", () => window.dispatchEvent(new Event("pxr:account-deleted")));
    socket.on("disconnect", reason => {
      if (reason === "io server disconnect") void fetchMe().then(user => {
        if (!user) window.dispatchEvent(new Event("pxr:account-deleted"));
      }).catch(() => undefined);
    });
    socket.on("connect", changed);
    const focused = () => { if (document.visibilityState === "visible") changed(); };
    document.addEventListener("visibilitychange", focused);
    window.addEventListener("focus", changed);
    void refresh();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000);
    return () => {
      requestRef.current++; socket.disconnect(); window.clearInterval(poll);
      document.removeEventListener("visibilitychange", focused); window.removeEventListener("focus", changed);
    };
  }, [user?.id, refresh]);
  return <NotificationContext.Provider value={{ unreadCount, revision, refresh }}>{children}</NotificationContext.Provider>;
}
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("NotificationProvider is missing");
  return context;
}
