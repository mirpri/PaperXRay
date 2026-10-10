import type { Annotation, HumanAnnotation, Role, Visibility } from "@paper-xray/contracts";
import { isAgentAnnotation, sliceByCodePoints, lensColor } from "@paper-xray/contracts";
import { AnnotationDiscussion } from "./AnnotationDiscussion";
import { annotationLensLabel } from "./lens-labels";
import { UserIdentity } from "./UserIdentity";

export function annotationCardElementId(annotationId: string): string {
  return `pxr-annotation-card-${annotationId}`;
}

export function AnnotationCard({
  annotation,
  normalizedText,
  active,
  onJumpTo,
  lensName,
  color: configuredColor,
  currentUserId,
  currentUserRole,
  repliesByParent,
  onCommentsChanged,
  onSetRunVisibility,
}: {
  annotation: Annotation;
  normalizedText: string;
  /** Display label from the reader; shared runs include the owner nickname. */
  lensName?: string;
  color?: string;
  currentUserId: string | null;
  currentUserRole?: Role;
  repliesByParent: Map<string, HumanAnnotation[]>;
  onCommentsChanged: () => void;
  /** Share/unshare the whole run this annotation belongs to — offered only on the viewer's own personal-lens runs. */
  onSetRunVisibility?: (runId: string, visibility: Visibility) => void;
  /** True right after this annotation's PDF mark was clicked — see pages/ReaderPage.tsx's activeAnnotationId. */
  active: boolean;
  onJumpTo: (annotationId: string) => void;
}) {
  const agent = isAgentAnnotation(annotation);
  const color = agent ? lensColor(annotation.agentId, configuredColor ?? annotation.lensColor) : "var(--human)";
  const ownRun = agent && annotation.ownerId !== null && annotation.ownerId === currentUserId;

  const header = (
    agent ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              className="mono"
              style={{
                fontSize: 9,
                padding: "3px 6px",
                borderRadius: 2,
                background: `${color}20`,
                color,
                letterSpacing: "0.06em",
              }}
            >
              {lensName ?? annotationLensLabel(annotation, currentUserId)}
            </span>
            {annotation.visibility === "private" && (
              <span className="mono" style={{ fontSize: 9, color: "var(--text-muted)" }}>
                PRIVATE
              </span>
            )}
          </div>
          <span
            className="mono"
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, color }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                background: color,
                display: "inline-block",
              }}
            />
            {annotation.severity.toUpperCase()}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UserIdentity name={annotation.authorName} />
          {annotation.visibility === "private" && (
            <span className="mono" style={{ fontSize: 9, color: "var(--text-muted)" }}>
              PRIVATE
            </span>
          )}
        </div>
      )
  );
  const content = <>
    {agent && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: "#242424" }}>
        {annotation.comment}
      </p>}

      {agent && (
        <div
          onClick={(e) => { e.stopPropagation(); onJumpTo(annotation.id); }}
          style={{
            background: "#F2F2F2",
            borderRadius: 3,
            padding: "9px 11px",
            display: "flex",
            flexDirection: "column",
            gap: 5,
            cursor: "pointer",
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
  </>;

  return (
    <div
      id={annotationCardElementId(annotation.id)}
      className={active ? "pxr-annotation-card pxr-annotation-card-active" : "pxr-annotation-card"}
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
      <AnnotationDiscussion
        annotation={annotation} byParent={repliesByParent} userId={currentUserId}
        role={currentUserRole} onChanged={onCommentsChanged}
        rootHeader={header} rootContent={content}
        runVisibilityAction={ownRun && onSetRunVisibility ? {
          currentVisibility: annotation.visibility,
          onToggle: () => onSetRunVisibility(annotation.runId, annotation.visibility === "private" ? "org" : "private"),
        } : undefined}
      />
    </div>
  );
}
