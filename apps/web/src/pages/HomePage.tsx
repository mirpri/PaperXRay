import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DocumentSummary, CollectionSummary } from "@paper-xray/contracts";
import { BookOpen, Library, ArrowRight } from "lucide-react";
import { fetchDocuments, fetchCollections } from "../api";
import { Header } from "../components/Header";
import { Logo } from "../components/Logo";

export function HomePage() {
  const [recentDocs, setRecentDocs] = useState<DocumentSummary[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [docsResult, collectionsResult] = await Promise.all([
          fetchDocuments({ search: "", sort: "newest", page: 1, pageSize: 5 }),
          fetchCollections(),
        ]);
        setRecentDocs(docsResult.documents);
        setCollections(collectionsResult);
      } catch (err) {
        console.error("Failed to load home page data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div style={{ minHeight: "100svh", background: "var(--bg)" }}>
      <Header />
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px" }}>
        {/* Logo Section */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <Logo size={80} />
          <h1 style={{ 
            fontFamily: "var(--font-serif)", 
            fontSize: 32, 
            fontWeight: 600, 
            margin: "16px 0 8px",
            color: "var(--text)"
          }}>
            Paper X-Ray
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
            Analyze and organize your research papers
          </p>
        </div>

        {/* Two Column Layout */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "1fr 1fr", 
          gap: 32,
          marginTop: 48,
          overflow: "hidden"
        }}>
          {/* Left Column: Recent Papers */}
          <section style={{ 
            borderRight: "1px solid var(--border)",
            paddingRight: 32,
            minWidth: 0,
            overflow: "hidden"
          }}>
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 8, 
              marginBottom: 16 
            }}>
              <Library size={20} color="var(--text-muted)" />
              <h2 style={{ 
                fontFamily: "var(--font-serif)", 
                fontSize: 20, 
                fontWeight: 600, 
                margin: 0 
              }}>
                Recent Papers
              </h2>
            </div>

            {loading ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</p>
            ) : recentDocs.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                No papers yet. Upload your first paper to get started.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8, width: "100%" }}>
                {recentDocs.map(doc => (
                  <li key={doc.id} style={{ width: "100%", overflow: "hidden" }}>
                    <Link 
                      to={`/documents/${doc.id}`}
                      style={{
                        display: "block",
                        padding: "12px 16px",
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        textDecoration: "none",
                        color: "var(--text)",
                        transition: "border-color 0.15s",
                        width: "100%",
                        maxWidth: "100%",
                        boxSizing: "border-box",
                        overflow: "hidden"
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-strong)"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                    >
                      <div style={{ 
                        fontFamily: "var(--font-serif)", 
                        fontSize: 14, 
                        fontWeight: 500,
                        marginBottom: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>
                        {doc.title || "Untitled"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {doc.pageCount} pages · {new Date(doc.createdAt).toLocaleDateString()}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <Link 
              to="/library"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 16,
                padding: "8px 16px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                textDecoration: "none",
                color: "var(--text)",
                fontSize: 13,
                fontWeight: 500,
                transition: "border-color 0.15s"
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-strong)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              Go to Library
              <ArrowRight size={14} />
            </Link>
          </section>

          {/* Right Column: Collections */}
          <section style={{
            minWidth: 0,
            overflow: "hidden"
          }}>
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 8, 
              marginBottom: 16 
            }}>
              <BookOpen size={20} color="var(--text-muted)" />
              <h2 style={{ 
                fontFamily: "var(--font-serif)", 
                fontSize: 20, 
                fontWeight: 600, 
                margin: 0 
              }}>
                My Collections
              </h2>
            </div>

            {loading ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</p>
            ) : collections.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                No collections yet. Create your first collection to organize papers.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8, width: "100%" }}>
                {collections.slice(0, 5).map(collection => (
                  <li key={collection.id} style={{ width: "100%", overflow: "hidden" }}>
                    <Link 
                      to={`/collections/${collection.id}`}
                      style={{
                        display: "block",
                        padding: "12px 16px",
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        textDecoration: "none",
                        color: "var(--text)",
                        transition: "border-color 0.15s",
                        width: "100%",
                        maxWidth: "100%",
                        boxSizing: "border-box",
                        overflow: "hidden"
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-strong)"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                    >
                      <div style={{ 
                        fontFamily: "var(--font-serif)", 
                        fontSize: 14, 
                        fontWeight: 500,
                        marginBottom: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>
                        {collection.name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {collection.documentCount} papers
                        {collection.isOwner && ` · ${collection.memberCount} shared`}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <Link 
              to="/collections"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 16,
                padding: "8px 16px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                textDecoration: "none",
                color: "var(--text)",
                fontSize: 13,
                fontWeight: 500,
                transition: "border-color 0.15s"
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-strong)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              Go to Collections
              <ArrowRight size={14} />
            </Link>
          </section>
        </div>
      </main>
    </div>
  );
}
