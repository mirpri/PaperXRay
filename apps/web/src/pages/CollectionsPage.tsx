import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { CollectionSummary, DocumentListQuery, DocumentPage, DocumentSort, DocumentSummary } from "@paper-xray/contracts";
import { BookOpen, Plus, Trash2, Upload, X, ArrowUp, ArrowDown, Share2, PowerOff, Edit2 } from "lucide-react";
import { addDocumentToCollection, createCollection, deleteCollection, fetchCollection, fetchCollectionUsers, fetchCollections, fetchDocuments, importDocumentToCollection, leaveCollection, removeDocumentFromCollection, saveCollection, saveCollectionMembers, uploadDocument } from "../api";
import { Header } from "../components/Header";
import { LibraryPagination } from "../components/LibraryPagination";
import { useToast } from "../ToastContext";
import { libraryQueryParams, readLibraryQuery } from "./library-query";

type SortField = "date" | "title" | "pages";
type SortDirection = "asc" | "desc";

const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "title", label: "Title" },
  { value: "pages", label: "Pages" },
];

function sortToFieldDirection(sort: DocumentSort): { field: SortField; direction: SortDirection } {
  switch (sort) {
    case "newest": return { field: "date", direction: "desc" };
    case "oldest": return { field: "date", direction: "asc" };
    case "title-asc": return { field: "title", direction: "asc" };
    case "title-desc": return { field: "title", direction: "desc" };
    case "pages-asc": return { field: "pages", direction: "asc" };
    case "pages-desc": return { field: "pages", direction: "desc" };
  }
}

function fieldDirectionToSort(field: SortField, direction: SortDirection): DocumentSort {
  switch (field) {
    case "date": return direction === "desc" ? "newest" : "oldest";
    case "title": return direction === "asc" ? "title-asc" : "title-desc";
    case "pages": return direction === "asc" ? "pages-asc" : "pages-desc";
  }
}
const inputStyle: React.CSSProperties = { height: 28, padding: "0 8px", border: "1px solid var(--border-strong)", borderRadius: 3, background: "var(--surface)", color: "var(--text)" };
const buttonStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer", display: "inline-flex", gap: 7, alignItems: "center", justifyContent: "center" };

export function CollectionsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [items, setItems] = useState<CollectionSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const reload = useCallback(() => fetchCollections().then(setItems).catch(e => showToast(String(e), "error")), []);
  useEffect(() => { void reload(); }, [reload]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const item = await createCollection({ name: name.trim(), description: description.trim() });
      setItems(current => [item, ...current]);
      setName("");
      setDescription("");
      setShowCreateForm(false);
      navigate(`/collections/${item.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const selectedCollection = id ? items.find(item => item.id === id) : null;

  return (
    <div style={{ minHeight: "100svh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <Header />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left sidebar */}
        <aside style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", background: "var(--panel)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border)" }}>
            <button
              type="button"
              className="pxr-btn pxr-btn-primary"
              style={{ width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => setShowCreateForm(v => !v)}
            >
              {showCreateForm ? <X size={14} /> : <Plus size={14} />}
              {showCreateForm ? "Cancel" : "New Collection"}
            </button>
            {showCreateForm && (
              <form onSubmit={create} style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <input
                  aria-label="Collection name"
                  placeholder="Collection name"
                  maxLength={120}
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
                <input
                  aria-label="Description (optional)"
                  placeholder="Description (optional)"
                  maxLength={500}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  style={inputStyle}
                />
                <button className="pxr-btn pxr-btn-primary" disabled={busy || !name.trim()}>
                  {busy ? "Creating…" : "Create"}
                </button>
              </form>
            )}
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {items.length ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {items.map(item => (
                  <li key={item.id}>
                    <Link
                      to={`/collections/${item.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 16px",
                        color: "var(--text)",
                        background: item.id === id ? "var(--surface)" : "transparent",
                        borderLeft: item.id === id ? "3px solid var(--human)" : "3px solid transparent",
                        textDecoration: "none",
                      }}
                    >
                      <BookOpen size={16} color="var(--text-muted)" />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</strong>
                        <span style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
                          {item.documentCount} papers{item.isOwner ? ` · ${item.memberCount} shared` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ padding: "24px 16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
                No collections yet
              </p>
            )}
          </div>
        </aside>

        {/* Right content area */}
        <main style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>
          {selectedCollection ? (
            <CollectionDetail collectionId={selectedCollection.id} onLeave={() => setItems(current => current.filter(item => item.id !== selectedCollection.id))} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 14 }}>
              {items.length ? "Select a collection to view its contents" : "Create a collection to get started"}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function CollectionDetail({ collectionId, onLeave }: { collectionId: string; onLeave: () => void }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const query = readLibraryQuery(params);
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [collection, setCollection] = useState<CollectionSummary | null>(null);
  const [page, setPage] = useState<DocumentPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; displayName: string; email: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [shareSearch, setShareSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const data = await fetchCollection(collectionId, query, signal);
    setCollection(data.collection);
    setPage(data.documentsPage);
    setName(data.collection.name);
    setDescription(data.collection.description);
    if (data.members) setSelected(data.members.map(m => m.userId));
  }, [collectionId, query.search, query.sort, query.page, query.pageSize]);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal).catch(e => {
      if (!controller.signal.aborted) showToast(String(e), "error");
    });
    return () => controller.abort();
  }, [reload, refresh]);

  useEffect(() => { setSearchDraft(query.search); }, [query.search]);

  useEffect(() => {
    if (searchDraft.trim() === query.search) return;
    const timer = window.setTimeout(() => setParams(libraryQueryParams({ ...query, search: searchDraft.trim(), page: 1 }), { replace: true }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, query, setParams]);

  async function remove(doc: DocumentSummary) {
    if (busy) return;
    setBusy(true);
    try {
      await removeDocumentFromCollection(collectionId, doc.id);
      showToast("Paper removed from collection.");
      setRefresh(v => v + 1);
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!collection || busy) return;
    setBusy(true);
    try {
      const updated = await saveCollection(collectionId, { name, description });
      setCollection(updated);
      setEdit(false);
      setRefresh(v => v + 1);
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function openSharing() {
    if (!collection?.isOwner) return;
    try {
      const options = await fetchCollectionUsers(collectionId);
      setUsers(options);
      setShareOpen(true);
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  async function saveSharing() {
    if (busy) return;
    setBusy(true);
    try {
      await saveCollectionMembers(collectionId, selected);
      setShareOpen(false);
      showToast("Sharing updated.");
      setRefresh(v => v + 1);
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeCollection() {
    if (!collection || busy || !window.confirm(`Delete "${collection.name}"? This will not delete papers from the Library.`)) return;
    setBusy(true);
    try {
      await deleteCollection(collectionId);
      navigate("/collections");
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!collection || busy || !window.confirm(`Leave "${collection.name}"? You will lose access, but the collection and its papers will remain.`)) return;
    setBusy(true);
    try {
      await leaveCollection(collectionId);
      onLeave();
      navigate("/collections");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!collection) {
    return <div style={{ color: "var(--text-muted)" }}>Loading collection…</div>;
  }

  const changeQuery = (changes: Partial<DocumentListQuery>) => setParams(libraryQueryParams({ ...query, ...changes }));

  return (
    <div>
      {edit ? (
        <form onSubmit={save} style={{ display: "grid", gap: 8, marginBottom: 18 }}>
          <input aria-label="Collection name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          <textarea aria-label="Description" maxLength={500} value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, height: 72, padding: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pxr-btn pxr-btn-primary" disabled={busy}>Save</button>
            <button className="pxr-btn" type="button" onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div style={{ display: "flex", alignItems: "start", gap: 8, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ font: "600 22px var(--font-serif)", margin: 0 }}>{collection.name}</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0" }}>
              {collection.description || (collection.isOwner ? "Owned by you" : `Shared by ${collection.ownerName}`)}
            </p>
            <span style={{ fontSize: 11, color: "var(--text-soft)" }}>
              {collection.documentCount} papers{collection.isOwner ? ` · shared with ${collection.memberCount} users` : ""}
            </span>
          </div>
          {collection.isOwner ? (
            <>
              <button type="button" style={buttonStyle} onClick={() => setEdit(true)}>
                <Edit2 size={14} />Edit
              </button>
              <button type="button" style={buttonStyle} onClick={openSharing}>
                <Share2 size={14} />Share
              </button>
              <button type="button" style={{ ...buttonStyle, color: "#a33" }} aria-label="Delete collection" onClick={() => void removeCollection()}>
                <Trash2 size={14} />Delete
              </button>
            </>
          ) : (
            <button type="button" style={{ ...buttonStyle, color: "#a33" }} disabled={busy} onClick={() => void leave()}>
              <PowerOff size={14} />Leave
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, margin: "20px 0" }}>
        <button type="button" className="pxr-btn pxr-btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={() => setImportOpen(true)}>
          <Plus size={14} />Import Papers
        </button>
      </div>

      <div className="pxr-library-controls">
        <input className="pxr-library-search" type="search" aria-label="Search collection" placeholder="Search collection" value={searchDraft} onChange={e => setSearchDraft(e.target.value)} />
        {(() => {
          const { field, direction } = sortToFieldDirection(query.sort);
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <select
                aria-label="Sort field"
                value={field}
                onChange={e => changeQuery({ sort: fieldDirectionToSort(e.target.value as SortField, direction), page: 1 })}
                style={{
                  height: 34,
                  padding: "0 8px",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 3,
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {SORT_FIELDS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button
                onClick={() => changeQuery({ sort: fieldDirectionToSort(field, direction === "asc" ? "desc" : "asc"), page: 1 })}
                title={direction === "asc" ? "Ascending" : "Descending"}
                style={{
                  width: 34,
                  height: 34,
                  padding: 0,
                  border: "1px solid var(--border-strong)",
                  borderRadius: 3,
                  background: "var(--surface)",
                  color: "var(--text)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {direction === "asc" ? <ArrowUp size={15} strokeWidth={1.75} /> : <ArrowDown size={15} strokeWidth={1.75} />}
              </button>
            </div>
          );
        })()}
      </div>

      {page?.documents.length ? (
        <ul className="pxr-library-list">
          {page.documents.map(doc => (
            <li key={doc.id} className="pxr-library-item">
              <div className="pxr-library-row">
                <Link className="pxr-library-title" to={`/documents/${doc.id}`}>{doc.title || "Untitled"}</Link>
                <span className="pxr-library-meta mono">{doc.pageCount} pages</span>
                <button
                  className="pxr-library-edit"
                  style={{ display: "inline-flex" }}
                  type="button"
                  aria-label={`Remove ${doc.title ?? "paper"} from collection`}
                  title="Remove from collection"
                  disabled={busy}
                  onClick={() => void remove(doc)}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pxr-library-empty">{page ? "This collection is empty." : "Loading papers…"}</p>
      )}

      {page && <LibraryPagination result={page} onPage={n => changeQuery({ page: n })} onPageSize={n => changeQuery({ pageSize: n, page: 1 })} />}

      {shareOpen && (
        <div
          role="presentation"
          onMouseDown={e => { if (e.target === e.currentTarget) setShareOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="share-title" style={{ width: "min(720px, 100%)", maxHeight: "80vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 4, padding: 20 }}>
            <h2 id="share-title" style={{ font: "600 18px var(--font-serif)", margin: "0 0 4px" }}>Share collection</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 16px" }}>Shared users can view this collection and add or remove papers.</p>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
              {/* Left column: Current members */}
              <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 3 }}>
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel)", fontSize: 12, fontWeight: 600 }}>
                  Current Members ({selected.length})
                </div>
                <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
                  {selected.length === 0 ? (
                    <p style={{ padding: "16px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 12, margin: 0 }}>No members yet</p>
                  ) : (
                    users.filter(u => selected.includes(u.id)).map(user => (
                      <div key={user.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13 }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.displayName}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
                        </span>
                        <button
                          type="button"
                          className="pxr-btn"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => setSelected(list => list.filter(id => id !== user.id))}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right column: Available users */}
              <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 3 }}>
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Organization Users</div>
                  <input
                    type="search"
                    placeholder="Search users..."
                    value={shareSearch}
                    onChange={e => setShareSearch(e.target.value)}
                    style={{ ...inputStyle, width: "100%", height: 30, fontSize: 12 }}
                  />
                </div>
                <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
                  {users.filter(u => !selected.includes(u.id) && (u.displayName.toLowerCase().includes(shareSearch.toLowerCase()) || u.email.toLowerCase().includes(shareSearch.toLowerCase()))).map(user => (
                    <div key={user.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.displayName}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
                      </span>
                      <button
                        type="button"
                        className="pxr-btn pxr-btn-primary"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() => setSelected(list => [...list, user.id])}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                  {users.filter(u => !selected.includes(u.id) && (u.displayName.toLowerCase().includes(shareSearch.toLowerCase()) || u.email.toLowerCase().includes(shareSearch.toLowerCase()))).length === 0 && (
                    <p style={{ padding: "16px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
                      {shareSearch ? "No matching users" : "All users added"}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "end", gap: 8, marginTop: 16 }}>
              <button className="pxr-btn" type="button" onClick={() => { setShareOpen(false); setShareSearch(""); }}>Cancel</button>
              <button className="pxr-btn pxr-btn-primary" type="button" disabled={busy} onClick={() => void saveSharing()}>Save sharing</button>
            </div>
          </section>
        </div>
      )}

      {importOpen && (
        <ImportModal
          collectionId={collectionId}
          onClose={() => setImportOpen(false)}
          onSuccess={(message: string) => {
            showToast(message);
            setRefresh(v => v + 1);
            setImportOpen(false);
          }}
          onError={(message: string) => showToast(message, "error")}
        />
      )}
    </div>
  );
}

function ImportModal({ collectionId, onClose, onSuccess, onError }: {
  collectionId: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"menu" | "url" | "library">("menu");
  const [url, setUrl] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [library, setLibrary] = useState<DocumentPage | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (mode !== "library") return;
    const controller = new AbortController();
    fetchDocuments({ search: librarySearch, sort: "newest", page: 1, pageSize: 20 }, controller.signal)
      .then(page => {
        setLibrary(page);
      })
      .catch(e => {
        if (!controller.signal.aborted) onError(String(e));
      });
    return () => controller.abort();
  }, [mode, librarySearch, onError]);

  useEffect(() => {
    if (mode !== "library" || !library) return;
    // Fetch current collection documents to mark which are already included
    fetchCollection(collectionId, { search: "", sort: "newest", page: 1, pageSize: 1000 })
      .then(data => {
        setIncluded(new Set(data.documentsPage.documents.map(d => d.id)));
      })
      .catch(() => {});
  }, [mode, collectionId, library]);

  async function importUrl(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || working) return;
    setWorking(true);
    try {
      const result = await importDocumentToCollection(collectionId, url.trim());
      onSuccess(result.added ? "Imported to the Library and added to this collection." : "That paper already exists in this collection.");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || working) return;
    setWorking(true);
    try {
      const doc = await uploadDocument(file);
      await addDocumentToCollection(collectionId, doc.id);
      onSuccess("Uploaded to the Library and added to this collection.");
    } catch (e) {
      onError(`${e instanceof Error ? e.message : String(e)}. If the upload completed, the paper remains in the organization Library and can be added from there.`);
    } finally {
      setWorking(false);
    }
  }

  async function add(doc: DocumentSummary) {
    if (working || included.has(doc.id)) return;
    setWorking(true);
    try {
      await addDocumentToCollection(collectionId, doc.id);
      setIncluded(prev => new Set([...prev, doc.id]));
      onSuccess("Paper added to collection.");
    } catch (e) {
      onError(String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      role="presentation"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="import-title" style={{ width: "min(560px, 100%)", maxHeight: "80vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 4, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 id="import-title" style={{ font: "600 18px var(--font-serif)", margin: 0 }}>
            {mode === "menu" ? "Import Papers" : mode === "url" ? "Import from URL" : "Add from Library"}
          </h2>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>

        {mode === "menu" && (
          <div style={{ display: "grid", gap: 10 }}>
            <button type="button" className="pxr-btn" style={{ ...buttonStyle, justifyContent: "flex-start", padding: "12px 16px" }} onClick={() => setMode("url")}>
              <Plus size={16} />Import from URL (arXiv, DOI, etc.)
            </button>
            <label className="pxr-btn" style={{ ...buttonStyle, justifyContent: "flex-start", padding: "12px 16px", cursor: working ? "default" : "pointer" }}>
              <Upload size={16} />Upload PDF
              <input type="file" accept="application/pdf" disabled={working} onChange={upload} style={{ display: "none" }} />
            </label>
            <button type="button" className="pxr-btn" style={{ ...buttonStyle, justifyContent: "flex-start", padding: "12px 16px" }} onClick={() => setMode("library")}>
              <BookOpen size={16} />Add from Library
            </button>
          </div>
        )}

        {mode === "url" && (
          <div>
            <form onSubmit={importUrl} style={{ display: "grid", gap: 10 }}>
              <input
                type="url"
                aria-label="Import URL"
                placeholder="https://arxiv.org/abs/..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                style={inputStyle}
                autoFocus
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="pxr-btn pxr-btn-primary" disabled={working || !url.trim()}>
                  {working ? "Working…" : "Import"}
                </button>
                <button className="pxr-btn" type="button" onClick={() => setMode("menu")}>Back</button>
              </div>
            </form>
          </div>
        )}

        {mode === "library" && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <input
                type="search"
                aria-label="Search library"
                placeholder="Search library…"
                value={librarySearch}
                onChange={e => setLibrarySearch(e.target.value)}
                style={{ ...inputStyle, width: "100%" }}
                autoFocus
              />
            </div>
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 3 }}>
              {library?.documents.map(doc => (
                <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-serif)", fontSize: 13 }}>
                    {doc.title || "Untitled"}
                  </span>
                  <button className="pxr-btn" type="button" disabled={working || included.has(doc.id)} onClick={() => void add(doc)}>
                    {included.has(doc.id) ? "Added" : "Add"}
                  </button>
                </div>
              ))}
              {library && library.documents.length === 0 && (
                <p style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13, margin: 0 }}>No papers found</p>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="pxr-btn" type="button" onClick={() => setMode("menu")}>Back</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
