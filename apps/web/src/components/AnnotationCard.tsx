import type { Annotation } from "@paper-xray/contracts";
import { isAgentAnnotation, sliceByCodePoints } from "@paper-xray/contracts";
import { Avatar } from "./Avatar";

const LENS_LABELS: Record<string, string> = {
  "preset-methodology-review": "Methodology",
  "preset-experiment-stats": "Experiment & Stats",
  "preset-reproducibility": "Reproducibility",
  "preset-novelty": "Novelty",
  "fake-lens": "Fake Lens",
};

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
}: {
  annotation: Annotation;
  normalizedText: string;
  /** True right after this annotation's PDF mark was clicked — see pages/ReaderPage.tsx's activeAnnotationId. */
  active: boolean;
  onJumpTo: (annotationId: string) => void;
}) {
  const agent = isAgentAnnotation(annotation);

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
              {LENS_LABELS[annotation.agentId] ?? annotation.agentId}
            </span>
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
      </div>
    </div>
  );
}
