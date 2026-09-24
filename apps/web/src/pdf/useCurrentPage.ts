import { useEffect, useState, type RefObject } from "react";

/**
 * Tracks which pdf.js page is most visible inside `containerRef`, by page
 * number (pdf.js gives every rendered page div a `data-page-number`
 * attribute — the same DOM hook ../pages/ReaderPage.tsx uses for
 * goToPage). PdfHighlighter offers no scroll-position API of its own, so
 * this reads the DOM directly with an IntersectionObserver.
 *
 * `resetKey` should change whenever the pages get torn down and re-created
 * (zoom remounts <PdfHighlighter> with a new `key`) — a MutationObserver on
 * the container re-attaches page observers whenever the DOM changes anyway,
 * but resetKey also forces current-page back to a sane starting point.
 */
export function useCurrentPage(containerRef: RefObject<HTMLElement | null>, resetKey: unknown): number {
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let intersectionObserver: IntersectionObserver | null = null;
    const visibleRatios = new Map<number, number>();

    function attachToPages() {
      const pages = container!.querySelectorAll<HTMLElement>("[data-page-number]");
      intersectionObserver?.disconnect();
      visibleRatios.clear();
      if (pages.length === 0) return;

      intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const pageNumber = Number(entry.target.getAttribute("data-page-number"));
            visibleRatios.set(pageNumber, entry.intersectionRatio);
          }
          let bestPage = 1;
          let bestRatio = 0;
          for (const [page, ratio] of visibleRatios) {
            if (ratio > bestRatio) {
              bestRatio = ratio;
              bestPage = page;
            }
          }
          if (bestRatio > 0) setCurrentPage(bestPage);
        },
        { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] },
      );
      pages.forEach((page) => intersectionObserver!.observe(page));
    }

    attachToPages();
    // pdf.js appends page divs asynchronously as it renders them, so the
    // first attachToPages() call often finds nothing yet — re-attach
    // whenever the container's subtree changes.
    const mutationObserver = new MutationObserver(attachToPages);
    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => {
      intersectionObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [containerRef, resetKey]);

  return currentPage;
}
