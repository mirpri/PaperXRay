import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DocumentSummary } from "@paper-xray/contracts";
import { fetchDocuments, uploadDocument } from "../api";
import { Header } from "../components/Header";

function titleFor(doc: DocumentSummary): string {
  return doc.originalFilename ?? `Untitled (${doc.contentHash.slice(0, 8)})`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Landing page: every paper anyone has uploaded, plus the upload control. */
export function LibraryPage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchDocuments()
      .then(setDocuments)
      .catch((err) => setError(String(err)));
  }

  useEffect(reload, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setStatus("uploading");
    setError(null);
    try {
      const doc = await uploadDocument(file);
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  }

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
            }}
          >
            {status === "uploading" ? "Uploading…" : "＋ Upload PDF"}
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              disabled={status === "uploading"}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {status === "error" && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}

        {documents === null ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>
        ) : documents.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            No papers yet — upload a PDF to get started.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {documents.map((doc) => (
              <li key={doc.id}>
                <button
                  onClick={() => navigate(`/documents/${doc.id}`)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "14px 16px",
                    background: "var(--surface)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 4,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: 14,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {titleFor(doc)}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: "var(--text-soft)", flexShrink: 0, letterSpacing: "0.04em" }}
                  >
                    {doc.pageCount} pages · {formatDate(doc.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
