import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { DocumentListQuery, DocumentPage, DocumentSort } from "@paper-xray/contracts";
import { fetchDocuments, importDocumentFromUrl, uploadDocument, type UploadProgress } from "../api";
import { Header } from "../components/Header";
import { DocumentListItem } from "../components/DocumentListItem";
import { useAuth } from "../auth/AuthContext";
import { Search, X, ArrowUp, ArrowDown } from "lucide-react";
import { LibraryPagination } from "../components/LibraryPagination";
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

/** Landing page: every paper anyone has uploaded, plus the upload control. */
export function LibraryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { search, sort, page, pageSize } = readLibraryQuery(searchParams);
  const [searchDraft, setSearchDraft] = useState(search);
  const [composing, setComposing] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsSection = useRef<HTMLElement>(null);
  const [result, setResult] = useState<DocumentPage | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "importing" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ phase: "uploading", percent: 0 });
  const [importUrl, setImportUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const changeQuery = useCallback((changes: Partial<DocumentListQuery>, replace = false) => {
    setSearchParams(current => libraryQueryParams({ ...readLibraryQuery(current), ...changes }), { replace });
  }, [setSearchParams]);

  useEffect(() => { setSearchDraft(search); }, [search]);
  useEffect(() => {
    if (composing || searchDraft.trim() === search) return;
    const timer = window.setTimeout(() => changeQuery({ search: searchDraft.trim(), page: 1 }, true), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft, search, changeQuery, composing]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setListLoading(true); setListError(null); setResult(null);
    fetchDocuments({ search, sort, page, pageSize }, controller.signal)
      .then(data => {
        if (!active) return;
        if (data.page !== page) { changeQuery({ page: data.page }, true); return; }
        setResult(data);
      })
      .catch(err => { if (active) setListError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [search, sort, page, pageSize, refresh, changeQuery]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    e.target.value = "";

    setStatus("uploading");
    setUploadProgress({ phase: "uploading", percent: 0 });
    setError(null);
    try {
      const doc = await uploadDocument(file, setUploadProgress);
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importUrl.trim() || busy) return;
    setStatus("importing");
    setError(null);
    try {
      const doc = await importDocumentFromUrl(importUrl.trim());
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  }

  const busy = status === "uploading" || status === "importing";
  const percent = status === "uploading" && uploadProgress.phase === "uploading" ? uploadProgress.percent : null;
  const progressLabel = status === "importing"
    ? "Importing PDF…"
    : uploadProgress.phase === "processing" ? "Processing PDF…" : "Uploading PDF…";

  return (
    <div style={{ minHeight: "100svh", background: "var(--bg)" }}>
      <Header />
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 24 }}>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 600, margin: 0 }}>Library</h1>
          <label
            style={{
              height: 34,
              padding: "0 15px",
              display: "flex",
              alignItems: "center",
              fontSize: 12,
              fontWeight: 500,
              color: "#FFFFFF",
              background: "var(--text)",
              borderRadius: 3,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {status === "uploading" ? "Uploading…" : "＋ Upload PDF"}
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              disabled={busy}
              style={{ display: "none" }}
            />
          </label>
        </div>

        <form onSubmit={handleImport} style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <input
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="Import from URL — e.g. https://arxiv.org/abs/1706.03762"
            disabled={busy}
            style={{
              flexGrow: 1,
              height: 34,
              padding: "0 10px",
              fontSize: 12,
              border: "1px solid var(--border-strong)",
              borderRadius: 3,
              background: "var(--surface)",
              color: "var(--text)",
            }}
          />
          <button
            type="submit"
            disabled={busy || !importUrl.trim()}
            style={{
              height: 34,
              padding: "0 15px",
              fontSize: 12,
              fontWeight: 500,
              border: "1px solid var(--border-strong)",
              borderRadius: 3,
              background: "var(--surface)",
              color: "var(--text)",
            }}
          >
            {status === "importing" ? "Importing…" : "Import"}
          </button>
        </form>

        {busy && (
          <div className="pxr-transfer" aria-busy="true">
            <div className="pxr-transfer-heading">
              <span role="status">{progressLabel}</span>
              {percent !== null && <span className="mono">{percent}%</span>}
            </div>
            <div
              className="pxr-transfer-track"
              role="progressbar"
              aria-label={progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              aria-valuetext={percent === null ? progressLabel : `${percent}% uploaded`}
            >
              <div
                className={`pxr-transfer-fill${percent === null ? " pxr-transfer-indeterminate" : ""}`}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
            <p className="pxr-transfer-hint">
              {status === "importing"
                ? "Downloading and processing the paper. This may take a moment."
                : uploadProgress.phase === "processing"
                  ? "Upload complete. Preparing your paper…"
                  : "Sending your PDF…"}
            </p>
          </div>
        )}

        {status === "error" && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}

        <div className="pxr-library-controls">
          <div className="pxr-library-search">
            <Search size={15} aria-hidden="true" />
            <input ref={searchInput} type="search" aria-label="Search papers by title" placeholder="Search by title…" maxLength={200}
              value={searchDraft} onChange={event => setSearchDraft(event.target.value)}
              onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
            {searchDraft && <button type="button" aria-label="Clear search" onClick={() => { setSearchDraft(""); changeQuery({ search: "", page: 1 }, true); searchInput.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}
          </div>
          {(() => {
            const { field, direction } = sortToFieldDirection(sort);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <select
                  aria-label="Sort field"
                  value={field}
                  onChange={event => changeQuery({ sort: fieldDirectionToSort(event.target.value as SortField, direction), page: 1 })}
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

        <section ref={resultsSection} className="pxr-library-results" aria-label="Papers" aria-busy={listLoading}>
          {listLoading && <p className="pxr-library-empty" role="status">Loading papers…</p>}
          {listError && <div className="pxr-library-load-error" role="alert">
            <span>{listError}</span><button type="button" className="pxr-btn" onClick={() => setRefresh(value => value + 1)}>Retry</button>
          </div>}
          {!listLoading && !listError && result && <>
            {result.documents.length === 0 ? <p className="pxr-library-empty">
              {search ? "No papers match your search." : "No papers yet — upload a PDF to get started."}
            </p> : <ul className="pxr-library-list">
              {result.documents.map(doc => <DocumentListItem key={doc.id} document={doc} canEdit={user?.role === "admin"}
                          canDelete={user?.role === "admin"}
                          onChanged={() => setRefresh(value => value + 1)}
                          onDeleted={() => setRefresh(value => value + 1)} />)}
                      </ul>}
                      <LibraryPagination result={result} onPage={next => { changeQuery({ page: next }); resultsSection.current?.scrollIntoView({ block: "start" }); }}
                        onPageSize={size => { changeQuery({ pageSize: size, page: 1 }); resultsSection.current?.scrollIntoView({ block: "start" }); }} />
                    </>}
        </section>
      </main>
    </div>
  );
}
