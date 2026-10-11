import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import type { DocumentSummary } from "@paper-xray/contracts";
import { updateDocumentTitle } from "../api";

export function DocumentListItem({ document: doc, canEdit, onChanged }: {
  document: DocumentSummary;
  canEdit: boolean;
  onChanged: (document: DocumentSummary) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [initial, setInitial] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const title = doc.title ?? `Untitled (${doc.contentHash.slice(0, 8)})`;

  function close() {
    if (pending.current) return;
    setEditing(false); setError(null);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || !draft.trim()) return;
    if (draft.trim() === initial) { close(); return; }
    pending.current = true; setBusy(true); setError(null);
    try {
      onChanged(await updateDocumentTitle(doc.id, draft.trim()));
      pending.current = false;
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      pending.current = false; setBusy(false);
    }
  }

  return <li className="pxr-library-item">
    <div className="pxr-library-row">
      {editing && canEdit ? <form className="pxr-library-title-form" onSubmit={save}
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget) && !pending.current && draft.trim() === initial) {
            setEditing(false); setError(null);
          }
        }}>
        <input aria-label="Paper title" autoFocus maxLength={500} value={draft} disabled={busy}
          onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)} />
        <button className="pxr-btn pxr-btn-primary" type="submit" disabled={busy || !draft.trim()}>{busy ? "Saving…" : "Save"}</button>
        <button className="pxr-btn" type="button" disabled={busy} onClick={close}>Cancel</button>
      </form> : <>
        <Link className="pxr-library-title" to={`/documents/${doc.id}`} title={title}>{title}</Link>
        {canEdit && <button ref={editButton} className="pxr-library-edit" type="button" title="Edit title" aria-label={`Edit title: ${title}`}
          onClick={() => { setDraft(doc.title ?? ""); setInitial((doc.title ?? "").trim()); setError(null); setEditing(true); }}>
          <Pencil size={13} aria-hidden="true" />
        </button>}
        <span className="pxr-library-meta mono">{doc.pageCount} pages · {new Date(doc.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
      </>}
    </div>
    {error && <p className="pxr-library-error" role="alert">{error}</p>}
  </li>;
}
