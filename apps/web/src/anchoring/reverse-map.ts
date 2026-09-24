import type { CharMap, CharRange } from "@paper-xray/contracts";

/**
 * Reverse mapping: CharRange (normalizedText code-point offsets) -> pixel
 * rectangles in PDF user-space, one rect per (page, item) the range touches.
 * This is the algorithm sketched in packages/contracts/src/ir.ts's CharMapRun
 * doc comment: for each CharMap run overlapping the range, take a
 * sub-rectangle of that item's bbox proportional to how much of the run's
 * own char span the overlap covers.
 *
 * `getItemGeometry` is supplied by the caller (the PDF viewer, which has
 * already rendered the page with pdfjs-dist and knows each item's bbox) —
 * this function itself has no DOM/canvas dependency, so it's plain
 * data-in/data-out and unit-testable without a browser.
 *
 * A linear scan over charMap is used rather than a binary search: CharMap
 * entries per document are in the thousands at most, so the O(n) scan is not
 * a real cost, and it avoids depending on charMap being gap-free (it isn't —
 * inserted whitespace/newlines between paragraphs have no run).
 */
export interface ItemGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function mapCharRangeToRects(
  range: CharRange,
  charMap: CharMap,
  getItemGeometry: (page: number, itemIndex: number) => ItemGeometry | undefined,
): PdfRect[] {
  const rects: PdfRect[] = [];

  for (const run of charMap) {
    const overlapStart = Math.max(range.start, run.charStart);
    const overlapEnd = Math.min(range.end, run.charEnd);
    if (overlapStart >= overlapEnd) continue;

    const geometry = getItemGeometry(run.page, run.itemIndex);
    if (!geometry) continue;

    // build-document.ts always produces one run per whole item
    // (itemCharStart=0, itemCharEnd=item's full code-point length), so the
    // run's own charStart..charEnd span corresponds 1:1 to the item's full
    // bbox — the overlap's position within that span, as a 0..1 fraction, is
    // directly the fraction of the item's bbox to take.
    const runCharSpan = run.charEnd - run.charStart;
    if (runCharSpan <= 0) continue;
    const fracStart = (overlapStart - run.charStart) / runCharSpan;
    const fracEnd = (overlapEnd - run.charStart) / runCharSpan;

    rects.push({
      page: run.page,
      x: geometry.x + geometry.width * fracStart,
      y: geometry.y,
      width: geometry.width * (fracEnd - fracStart),
      height: geometry.height,
    });
  }

  return rects.sort((a, b) => a.page - b.page || a.x - b.x);
}
