import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Annotation, ModelProvider } from "@paper-xray/contracts";
import { fetchProviders, requestAiReply, submitAiReplyResult } from "../api";
import { loadProviderKey } from "../personal/provider-keys";
import { useToast } from "../ToastContext";
import { ProviderModelFields } from "./ProviderModelFields";

export function AiReplyComposer({ annotation, userId, onChanged, onClose }: {
  annotation: Annotation; userId: string; onChanged: () => void; onClose: () => void;
}) {
  const { showToast } = useToast();
  const storageKey = `pxr.aiReply.${userId}`;
  const [selection, setSelection] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (typeof saved?.providerId === "string" && typeof saved?.model === "string") return { providerId: saved.providerId, model: saved.model };
    } catch { /* Storage may be unavailable. */ }
    return { providerId: "", model: "" };
  });
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const initialSelection = useRef(selection);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    let cancelled = false;
    fetchProviders().then(items => { if (!cancelled) setProviders(items); })
      .catch(err => { if (!cancelled) showToast(String(err), "error"); });
    return () => { cancelled = true; };
  }, [showToast]);

  async function submit() {
    if (submitting.current) return;
    const provider = providers.find(item => item.id === selection.providerId);
    if (!provider || !selection.model.trim()) return;
    submitting.current = true; setBusy(true);
    let pendingReplyId: string | null = null;
    try {
      try { localStorage.setItem(storageKey, JSON.stringify(selection)); } catch { /* Optional preference. */ }
      const result = await requestAiReply(annotation.docId, annotation.id, {
        parentKind: "authorId" in annotation ? "human" : "agent", ...selection, model: selection.model.trim(),
      });
      onChanged();
      if (result.reused) { showToast("AI is already replying to this comment.", "info"); onClose(); return; }
      if (result.executionContext === "org-server") { onClose(); return; }
      pendingReplyId = result.annotation.id;
      if (!result.messages) throw new Error("Could not load the discussion context");
      const key = loadProviderKey(userId, provider.id);
      const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST", signal: AbortSignal.timeout(8 * 60_000),
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: selection.model.trim(), messages: result.messages, temperature: 0.2 }),
      });
      if (!response.ok) throw new Error(`Model call failed: HTTP ${response.status}`);
      const data = await response.json();
      const answer = data.choices?.[0]?.message?.content;
      if (typeof answer !== "string" || !answer.trim() || answer.length > 10000) throw new Error("AI answer must contain 1–10000 characters");
      await submitAiReplyResult(annotation.docId, pendingReplyId, answer.trim());
      pendingReplyId = null;
      onChanged(); onClose();
    } catch (err) {
      if (pendingReplyId) {
        try { await submitAiReplyResult(annotation.docId, pendingReplyId, "", true); } catch { /* Lease expiry will recover interrupted browser requests. */ }
        onChanged();
      }
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally { submitting.current = false; setBusy(false); }
  }

  return <form className="pxr-comment-editor" aria-label="Reply with AI" aria-busy={busy} onClick={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }}
    onBlur={event => {
      if (!busy && selection.providerId === initialSelection.current.providerId &&
          selection.model === initialSelection.current.model && !event.currentTarget.contains(event.relatedTarget)) onClose();
    }}
    onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))", gap: 8 }}>
      <ProviderModelFields providers={providers} userId={userId} {...selection} disabled={busy} autoFocus
        onChange={(providerId, model) => setSelection({ providerId, model })} />
    </div>
    {!providers.length && <Link to="/admin" style={{ fontSize: 11 }}>Manage providers →</Link>}
    <div className="pxr-comment-editor-footer"><div className="pxr-comment-editor-buttons">
      <button type="button" className="pxr-btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="submit" className="pxr-btn pxr-btn-primary" disabled={busy || !providers.some(item => item.id === selection.providerId) || !selection.model.trim()}>
        {busy ? "AI is replying…" : "Reply with AI"}
      </button>
    </div></div>
  </form>;
}
