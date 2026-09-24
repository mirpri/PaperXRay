import { TextHighlight, useHighlightContainerContext } from "react-pdf-highlighter-extended";
import type { PxrHighlight } from "./annotations-to-highlights";

/**
 * The single highlight-rendering component react-pdf-highlighter-extended
 * calls (via context, once per highlight-per-page) for every entry in
 * `highlights`. Colors by agent (yellow) vs human (blue) via the CSS
 * wrapper classes in index.css, and forwards clicks so the sidebar
 * annotation card can be found and emphasized (see pages/ReaderPage.tsx's
 * jumpToCard).
 */
export function PxrHighlightContainer({ onHighlightClick }: { onHighlightClick: (annotationId: string) => void }) {
  const { highlight, isScrolledTo } = useHighlightContainerContext<PxrHighlight>();

  return (
    <div className={highlight.isAgent ? "pxr-highlight-agent" : "pxr-highlight-human"}>
      <TextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        onClick={() => onHighlightClick(highlight.annotationId)}
      />
    </div>
  );
}
