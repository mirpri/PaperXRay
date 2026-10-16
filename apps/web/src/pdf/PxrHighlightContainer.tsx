import type { CSSProperties } from "react";
import { TextHighlight, useHighlightContainerContext } from "react-pdf-highlighter-extended";
import type { PxrHighlight } from "./annotations-to-highlights";

/**
 * The single highlight-rendering component react-pdf-highlighter-extended
 * calls (via context, once per highlight-per-page) for every entry in
 * `highlights`. Gray human fills and Lens-colored agent fills, with configurable underlines via the CSS
 * wrapper classes in index.css, and forwards clicks so the sidebar
 * annotation card can be found and emphasized (see pages/ReaderPage.tsx's
 * jumpToCard).
 */
export function PxrHighlightContainer({ onHighlightClick }: { onHighlightClick: (annotationId: string) => void }) {
  const { highlight, isScrolledTo } = useHighlightContainerContext<PxrHighlight>();
  const ghost = !highlight.annotationId;

  return (
    <div className={`${highlight.isAgent ? "pxr-highlight-agent" : "pxr-highlight-human"}${ghost ? " pxr-highlight-draft" : ""}`}
      style={{ "--annotation-color": highlight.color } as CSSProperties}>
      <TextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        onClick={ghost ? undefined : () => onHighlightClick(highlight.annotationId)}
      />
    </div>
  );
}
