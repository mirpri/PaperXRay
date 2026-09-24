import type { RawTextItem } from "../extraction/types.js";
import { splitIntoBands } from "./bands.js";
import { clusterLines, type Line } from "./lines.js";

const MIN_ITEMS_FOR_COLUMN_DETECTION = 10;
const HISTOGRAM_BIN_COUNT = 40;

/**
 * Column-aware line assembly for one page (docs/01-nabcd-architecture.md
 * "三个关键技术难点" #1 step 2: "对 x 坐标做直方图，双峰即双栏；分组后再排序").
 *
 * First splits the page into vertical bands wherever there's a large gap
 * between lines (see ./bands.ts — typically a figure/table sitting between
 * two text blocks), then runs column detection independently within each
 * band, so a full-width figure in the middle of the page can't corrupt the
 * column split for the text above and below it.
 */
export function assemblePageLines(items: RawTextItem[], page: number, pageWidth: number): Line[] {
  return splitIntoBands(items).flatMap((bandItems) => assembleBandLines(bandItems, page, pageWidth));
}

/**
 * Classifies whole raw lines (not individual items) against the detected
 * boundary. This matters because a genuinely full-width line — a running
 * header/footer, or a body sentence that happens to have an italicized
 * word split into its own text item right around the boundary x-position —
 * is very often split across *several* pdfjs text items by pdfjs-dist
 * itself (font/style changes start a new item). Classifying item-by-item
 * would scatter such a line's pieces into left/right/header semi-randomly
 * depending on exactly where each fragment's own x-range happens to fall.
 * Instead: if a line's overall span straddles the boundary, check whether
 * there's an actual gap in its own items near the boundary (real two
 * left+right column content sharing one row) — if not, it's one continuous
 * run of text that merely crosses the boundary value, so keep it intact as
 * a full-width line.
 */
function assembleBandLines(items: RawTextItem[], page: number, pageWidth: number): Line[] {
  const rawLines = clusterLines(items, page);
  const boundary = detectColumnBoundary(items, pageWidth);
  if (boundary === null) {
    return rawLines;
  }

  const margin = medianFontSize(items) * 0.5;
  const leftItems: RawTextItem[] = [];
  const rightItems: RawTextItem[] = [];
  const fullWidthLines: Line[] = [];

  for (const line of rawLines) {
    if (line.maxX <= boundary + margin) {
      leftItems.push(...line.items);
    } else if (line.minX >= boundary - margin) {
      rightItems.push(...line.items);
    } else {
      const splitAt = findInternalGapNearBoundary(line.items, boundary, margin);
      if (splitAt === null) {
        fullWidthLines.push(line);
      } else {
        leftItems.push(...line.items.slice(0, splitAt));
        rightItems.push(...line.items.slice(splitAt));
      }
    }
  }

  if (leftItems.length === 0 || rightItems.length === 0) {
    // One side came up empty — this wasn't really two columns; don't force it.
    return rawLines;
  }

  const columnTop = Math.max(...leftItems.map((i) => i.y), ...rightItems.map((i) => i.y));
  const header = fullWidthLines.filter((l) => l.y > columnTop);
  const footer = fullWidthLines.filter((l) => l.y <= columnTop);

  return [...header, ...clusterLines(leftItems, page), ...clusterLines(rightItems, page), ...footer];
}

/** items is left-to-right sorted (clusterLines guarantees this). Returns the index to split at if there's a real gap straddling the boundary, else null. */
function findInternalGapNearBoundary(items: RawTextItem[], boundary: number, margin: number): number | null {
  for (let i = 1; i < items.length; i++) {
    const prevEnd = items[i - 1].x + items[i - 1].width;
    const start = items[i].x;
    const gapStraddlesBoundary = prevEnd <= boundary + margin && start >= boundary - margin;
    if (gapStraddlesBoundary && start - prevEnd > margin) {
      return i;
    }
  }
  return null;
}

/**
 * Bins every item's x-center into a histogram and looks for a valley
 * between two peaks in the central band of the page. This is deliberately
 * independent of which line an item falls on: real typeset two-column text
 * commonly has left/right columns whose line grids drift out of alignment
 * over the page (justification and hyphenation make lines wrap at slightly
 * different heights per column), so a strategy that requires both columns'
 * items to land on the *same* line (an earlier version of this function did)
 * rarely finds enough evidence on real PDFs even though it works on
 * artificially row-aligned test fixtures. Histogramming the whole item
 * population sidesteps that entirely.
 */
function detectColumnBoundary(items: RawTextItem[], pageWidth: number): number | null {
  // Only the running body text actually flows in columns — titles, author
  // blocks, footnote markers, and figure/diagram labels are typically set
  // in different font sizes and cluster at x-positions that have nothing
  // to do with the column layout (e.g. an author-name block can produce a
  // large spurious peak). Restricting the histogram to items at the page's
  // single most common font size isolates the real body-text signal. A
  // genuinely column-confined item also can't be wider than roughly half
  // the page (titles/running headers spanning the full width would
  // otherwise center almost exactly on the true column midpoint, filling
  // in the very valley being looked for).
  const bodyFontSize = modalFontSize(items);
  const bodyItems = items.filter(
    (i) => Math.abs(i.fontSize - bodyFontSize) < 0.5 && i.width < pageWidth * 0.5,
  );
  if (bodyItems.length < MIN_ITEMS_FOR_COLUMN_DETECTION) return null;

  const centers = bodyItems.map((i) => i.x + i.width / 2);
  const minCenter = Math.min(...centers);
  const maxCenter = Math.max(...centers);
  const spread = maxCenter - minCenter;
  if (spread < pageWidth * 0.3) return null; // too narrow a spread to plausibly be two columns

  const binWidth = spread / HISTOGRAM_BIN_COUNT;
  const bins = new Array(HISTOGRAM_BIN_COUNT).fill(0) as number[];
  for (const center of centers) {
    const idx = Math.min(HISTOGRAM_BIN_COUNT - 1, Math.max(0, Math.floor((center - minCenter) / binWidth)));
    bins[idx]++;
  }

  // Find the two dominant modes directly (the left- and right-column text
  // centers) rather than searching for a single "best valley" bin: real
  // pages often have a wide plateau of near-zero bins in the gutter, and
  // scoring by "how deep is this one bin" picks whichever edge of that
  // plateau comes first in the scan, not its middle. The two-peak midpoint
  // is a much better estimate of the true column boundary.
  const peak1Idx = argmax(bins);
  const suppressed = bins.map((count, i) => (Math.abs(i - peak1Idx) <= 3 ? 0 : count));
  const peak2Idx = argmax(suppressed);
  const peak1Count = bins[peak1Idx];
  const peak2Count = bins[peak2Idx];

  if (peak2Count === 0 || peak2Count < peak1Count * 0.15) return null; // not really bimodal

  const loIdx = Math.min(peak1Idx, peak2Idx);
  const hiIdx = Math.max(peak1Idx, peak2Idx);
  if (hiIdx - loIdx < 2) return null; // peaks too close together to have a real gutter between them

  const valleyBetween = Math.min(...bins.slice(loIdx + 1, hiIdx));
  const smallerPeak = Math.min(peak1Count, peak2Count);
  if (valleyBetween > smallerPeak * 0.35) return null; // no real dip between the two modes

  const boundary = (minCenter + (peak1Idx + 0.5) * binWidth + minCenter + (peak2Idx + 0.5) * binWidth) / 2;

  // Roughly central on the page (rules out e.g. a ragged margin peak near one edge).
  if (boundary < pageWidth * 0.25 || boundary > pageWidth * 0.75) return null;

  return boundary;
}

function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

function medianFontSize(items: RawTextItem[]): number {
  const sizes = items.map((i) => i.fontSize).sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 10;
}

/** The single most common font size on the page/band, rounded to the nearest 0.5pt — a proxy for "the running body text font". */
function modalFontSize(items: RawTextItem[]): number {
  const counts = new Map<number, number>();
  for (const item of items) {
    const rounded = Math.round(item.fontSize * 2) / 2;
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }
  let bestSize = 0;
  let bestCount = 0;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestSize = size;
    }
  }
  return bestSize;
}
