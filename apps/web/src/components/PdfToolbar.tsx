import { useEffect, useState } from "react";

const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/**
 * Zoom + page-jump controls. react-pdf-highlighter@7 doesn't react to a
 * changed `pdfScaleValue` prop after mount (only reads it once, at initial
 * document-ready) and doesn't expose its internal PDFViewer instance to the
 * parent at all — so "zoom" here works by remounting <PdfHighlighter> with a
 * new `key` (forcing a fresh init that picks up the new pdfScaleValue), and
 * "go to page" works by scrolling the actual page <div data-page-number>
 * pdf.js's own viewer renders, both driven from outside the library rather
 * than through any API it offers for this.
 */
export function PdfToolbar({
  scale,
  onScaleChange,
  pageCount,
  currentPage,
  onGoToPage,
}: {
  scale: number;
  onScaleChange: (scale: number) => void;
  pageCount: number | null;
  /** Tracked from actual scroll position (see ../pdf/useCurrentPage.ts) — the page input mirrors it until the user types their own value. */
  currentPage: number;
  onGoToPage: (page: number) => void;
}) {
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  function zoomOut() {
    const next = [...ZOOM_STEPS].reverse().find((s) => s < scale) ?? ZOOM_STEPS[0];
    onScaleChange(next);
  }

  function zoomIn() {
    const next = ZOOM_STEPS.find((s) => s > scale) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    onScaleChange(next);
  }

  function goToPage(page: number) {
    if (!pageCount) return;
    const clamped = Math.min(Math.max(page, 1), pageCount);
    setPageInput(String(clamped));
    onGoToPage(clamped);
  }

  return (
    <div className="pxr-toolbar">
      <button onClick={zoomOut} aria-label="Zoom out">
        −
      </button>
      <span className="mono" style={{ fontSize: 11, minWidth: 38, textAlign: "center" }}>
        {Math.round(scale * 100)}%
      </span>
      <button onClick={zoomIn} aria-label="Zoom in">
        +
      </button>
      <div className="pxr-toolbar-sep" />
      <button onClick={() => goToPage((Number(pageInput) || 1) - 1)} aria-label="Previous page">
        ‹
      </button>
      <input
        value={pageInput}
        onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") goToPage(Number(pageInput) || 1);
        }}
        aria-label="Page number"
      />
      <span className="mono" style={{ fontSize: 11 }}>
        / {pageCount ?? "…"}
      </span>
      <button onClick={() => goToPage(Number(pageInput) + 1)} aria-label="Next page">
        ›
      </button>
      <button onClick={() => goToPage(Number(pageInput) || 1)} style={{ fontWeight: 500 }}>
        Go
      </button>
    </div>
  );
}
