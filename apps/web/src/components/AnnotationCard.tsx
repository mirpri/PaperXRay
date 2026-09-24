import type { Annotation, Visibility } from "@paper-xray/contracts";
import { isAgentAnnotation, sliceByCodePoints } from "@paper-xray/contracts";
import { Avatar } from "./Avatar";


const SEVERITY_COLOR: Record<string, string> = {
  high: "var(--agent)",
  medium: "var(--agent)",
  low: "#9A9A9A",
  info: "#9A9A9A",
};

export function annotationCardElementId(annotationId: string): string {
  return `pxr-annotation-card-${annotationId}`;
}

export function AnnotationCard({
  annotation,
  normalizedText,
  active,
  onJumpTo,
  lensName,
  currentUserId,
  onSetRunVisibility,
}: {
  annotation: Annotation;
  normalizedText: string;
  /** Display name of the lens that produced an agent annotation (falls back to its id, e.g. for a deleted lens). */
  lensName?: string;
  currentUserId: string | null;
  /** Share/unshare the whole run this annotation belongs to — offered only on the viewer's own personal-lens runs. */
  onSetRunVisibility?: (runId: string, visibility: Visibility) => void;
  /** True right after this annotation's PDF mark was clicked — see pages/ReaderPage.tsx's activeAnnotationId. */
  active: boolean;
  onJumpTo: (annotationId: string) => void;
}) {
  const agent = isAgentAnnotation(annotation);
  const ownRun = agent && annotation.ownerId !== null && annotation.ownerId === currentUserId;

  return (
    <div
      id={annotationCardElementId(annotation.id)}
      className={active ? "pxr-annotation-card-active" : undefined}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: 4,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      {agent ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              className="mono"
              style={{
                fontSize: 9,
                padding: "3px 6px",
                borderRadius: 2,
                background: "var(--agent-soft)",
                color: "var(--agent-ink)",
                letterSpacing: "0.06em",
              }}
            >
              {lensName ?? annotation.agentId}
            </span>
            {annotation.visibility === "private" && (
              <span className="mono" style={{ fontSize: 9, color: "var(--text-muted)" }}>
                PRIVATE
              </span>
            )}
          </div>
          <span
            className="mono"
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, color: "var(--agent-ink)" }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                background: SEVERITY_COLOR[annotation.severity],
                display: "inline-block",
              }}
            />
            {annotation.severity.toUpperCase()}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar name="Member" size={21} />
          <span style={{ fontSize: 12, fontWeight: 500 }}>Human note</span>
          {annotation.visibility === "private" && (
            <span className="mono" style={{ fontSize: 9, color: "var(--text-muted)" }}>
              PRIVATE
            </span>
          )}
        </div>
      )}

      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: "#242424" }}>
        {agent ? annotation.comment : annotation.body}
      </p>

      {agent && (
        <div
          style={{
            background: "#F2F2F2",
            borderRadius: 3,
            padding: "9px 11px",
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          <span className="mono" style={{ fontSize: 8, letterSpacing: "0.16em", color: "var(--text-muted)" }}>
            EVIDENCE
          </span>
          <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 12, lineHeight: 1.6, color: "#4A4A4A" }}>
            {sliceByCodePoints(normalizedText, annotation.evidenceSpan.start, annotation.evidenceSpan.end)}
          </span>
          <span className="mono" style={{ fontSize: 9, color: "var(--text-soft)" }}>
            confidence {annotation.confidence.toFixed(2)}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 7 }}>
        <button
          onClick={() => onJumpTo(annotation.id)}
          style={{
            fontSize: 11,
            height: 29,
            padding: "0 10px",
            border: "1px solid var(--border-strong)",
            borderRadius: 3,
            background: "var(--surface)",
            color: "var(--text)",
          }}
        >
          Jump to text
        </button>
        {ownRun && onSetRunVisibility && (
          <button
            onClick={() => onSetRunVisibility(annotation.runId, annotation.visibility === "private" ? "org" : "private")}
            title="Applies to every annotation from this run"
            style={{
              fontSize: 11,
              height: 29,
              padding: "0 10px",
              border: "1px solid var(--border-strong)",
              borderRadius: 3,
              background: "var(--surface)",
              color: "var(--text)",
            }}
          >
            {annotation.visibility === "private" ? "Share run with org" : "Make run private"}
          </button>
        )}
      </div>
    </div>
  );
}
