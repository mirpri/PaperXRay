import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AnnotationNotification } from "@paper-xray/contracts";
import { fetchNotifications, markAllMessagesRead, markMessageRead } from "../api";
import { useNotifications } from "../NotificationContext";
import { Header } from "../components/Header";
import { UserIdentity } from "../components/UserIdentity";

const messageDescriptions: Record<AnnotationNotification["kind"], string> = {
  reply: "replied to your comment",
  upvote: "upvoted your annotation",
  downvote: "downvoted your annotation",
  cancel_upvote: "removed an upvote from your annotation",
  cancel_downvote: "removed a downvote from your annotation",
  collection_shared: "shared a collection with you",
  collection_left: "left your collection",
  membership_requested: "requested to join the organization",
};

export function MessagesPage() {
  const { unreadCount, revision, refresh } = useNotifications();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AnnotationNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const request = ++sequence.current;
    setLoading(true); setLoadingMore(false);
    fetchNotifications().then(page => {
      if (sequence.current !== request) return;
      setMessages(page.notifications); setCursor(page.nextCursor); setError(null);
    }).catch(err => { if (sequence.current === request) setError(String(err)); })
      .finally(() => { if (sequence.current === request) setLoading(false); });
    return () => { sequence.current++; };
  }, [revision]);
  async function loadMore() {
    if (!cursor || loadingMore) return;
    const request = sequence.current; setLoadingMore(true);
    try {
      const page = await fetchNotifications(cursor);
      if (sequence.current !== request) return;
      setMessages(current => [...current, ...page.notifications.filter(item => !current.some(old => old.id === item.id))]);
      setCursor(page.nextCursor);
    } catch (err) { if (sequence.current === request) setError(String(err)); }
    finally { if (sequence.current === request) setLoadingMore(false); }
  }
  async function read(message: AnnotationNotification) {
    if (!message.readAt) {
      await markMessageRead(message.id);
      setMessages(current => current.map(item => item.id === message.id ? { ...item, readAt: new Date().toISOString() } : item));
      await refresh();
    }
  }
  async function open(event: MouseEvent<HTMLAnchorElement>, message: AnnotationNotification, url: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { void read(message).catch(err => setError(String(err))); return; }
    event.preventDefault();
    try { await read(message); navigate(url); } catch (err) { setError(String(err)); }
  }
  async function readAll() {
    setMarkingAll(true); setError(null);
    try {
      await markAllMessagesRead();
      setMessages(current => current.map(item => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      await refresh();
    } catch (err) { setError(String(err)); }
    finally { setMarkingAll(false); }
  }
  return <div className="pxr-settings-page">
    <Header left={<span style={{ fontSize: 13, fontWeight: 500 }}>Messages</span>} />
    <main className="pxr-admin-main pxr-settings-scroll">
      <div className="pxr-messages-content">
        <div className="pxr-messages-heading">
          <div><h1>Messages</h1><p>{unreadCount ? `${unreadCount} unread` : "Replies and votes on your annotations appear here."}</p></div>
          <button type="button" className="pxr-btn" disabled={!unreadCount || markingAll} onClick={() => void readAll()}>{markingAll ? "Updating…" : "Mark all read"}</button>
        </div>
        {error && <p role="alert" className="pxr-message-error">{error}</p>}
        {loading && messages.length === 0 ? <p role="status">Loading messages…</p> : messages.length === 0 && !error ? <p className="pxr-message-empty">No messages yet.</p> : null}
        <ul className="pxr-message-list" aria-busy={loading}>
          {messages.map(message => {
            const isCollectionMessage = message.kind === "collection_shared" || message.kind === "collection_left";
            const isMembershipMessage = message.kind === "membership_requested";
            const url = isMembershipMessage ? "/admin?section=users" : isCollectionMessage ? `/collections/${message.collectionId}` : `/documents/${message.docId}?comment=${encodeURIComponent(message.targetId)}`;
            return <li key={message.id} className={`pxr-message${message.readAt ? "" : " pxr-message-unread"}`}>
              <div className="pxr-message-header">
                <UserIdentity name={message.actorName} />
                <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                {!message.readAt && <span className="pxr-unread-dot" aria-label="Unread" />}
              </div>
              <p className="pxr-message-context">{messageDescriptions[message.kind]}{!isMembershipMessage && <> · {isCollectionMessage ? `“${message.documentTitle}”` : message.documentTitle ?? "Untitled paper"}</>}</p>
              {message.kind === "reply" && <blockquote>{message.parentPreview || "[Comment deleted]"}</blockquote>}
              <p className="pxr-message-preview">{message.preview}</p>
              <div className="pxr-message-footer">
                <Link to={url} onClick={event => void open(event, message, url)} onAuxClick={event => { if (event.button === 1) void read(message).catch(err => setError(String(err))); }}>{isMembershipMessage ? "Review member" : isCollectionMessage ? "View collection" : message.kind === "reply" ? "View reply" : "View annotation"} →</Link>
                {!message.readAt && <button type="button" onClick={() => { void read(message).catch(err => setError(String(err))); }}>Mark read</button>}
              </div>
            </li>;
          })}
        </ul>
        {cursor && <button type="button" className="pxr-btn" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</button>}
      </div>
    </main>
  </div>;
}
