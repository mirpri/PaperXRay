import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

import { ZOOM_STEPS } from "../pdf/usePdfZoom";

/** Controls the live PDF.js viewer without remounting its pages. */
export function PdfToolbar({
  scale,
  onScaleChange,
  pageCount,
  currentPage,
  onGoToPage,
  asideCollapsed,
  onToggleAside,
}: {
  scale: number;
  onScaleChange: (scale: number) => void;
  pageCount: number | null;
  /** Tracked from actual scroll position (see ../pdf/useCurrentPage.ts) — the page input mirrors it until the user types their own value. */
  currentPage: number;
  onGoToPage: (page: number) => void;
  asideCollapsed: boolean;
  onToggleAside: () => void;
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
      <button onClick={zoomOut} aria-label="Zoom out" disabled={scale <= ZOOM_STEPS[0]}>
        −
      </button>
      <span className="mono" style={{ fontSize: 11, minWidth: 38, textAlign: "center" }}>
        {Math.round(scale * 100)}%
      </span>
      <button onClick={zoomIn} aria-label="Zoom in" disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
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
      <div className="pxr-toolbar-sep" />
      <button
        onClick={onToggleAside}
        aria-label={asideCollapsed ? "Show annotations" : "Hide annotations"}
        title={asideCollapsed ? "Show annotations" : "Hide annotations"}
        style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {asideCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
      </button>
    </div>
  );
}
