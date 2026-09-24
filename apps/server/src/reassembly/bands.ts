import type { RawTextItem } from "../extraction/types.js";
import { clusterLines } from "./lines.js";

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Splits a page's items into vertical bands wherever there's an unusually
 * large gap between consecutive (column-blind) lines — typically a figure,
 * table, or large whitespace region.
 *
 * Why this exists: a two-column academic page commonly interleaves
 * two-column text with full-width figures/tables in the middle of the
 * page. A single page-wide column boundary (./columns.ts on its own)
 * can't represent that — the figure's caption/label text (chaotic x
 * positions) corrupts the boundary detection or gets misclassified into
 * whichever column happens to overlap its x range, scrambling reading
 * order for the text blocks above *and* below it. Splitting into bands
 * first and running column detection independently within each band
 * contains the damage to the band that actually has the figure.
 */
export function splitIntoBands(items: RawTextItem[]): RawTextItem[][] {
  if (items.length === 0) return [];

  const lines = clusterLines(items, 1); // page number is irrelevant here, discarded
  if (lines.length < 3) return [items];

  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0);
  const typicalGap = median(gaps);
  const breakThreshold = Math.max(typicalGap * 4, lines[0].fontSize * 6);

  const yBoundaries: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i - 1].y - lines[i].y > breakThreshold) {
      yBoundaries.push((lines[i - 1].y + lines[i].y) / 2);
    }
  }

  if (yBoundaries.length === 0) return [items];

  const bands: RawTextItem[][] = Array.from({ length: yBoundaries.length + 1 }, () => []);
  for (const item of items) {
    let bandIndex = 0;
    for (const boundary of yBoundaries) {
      if (item.y < boundary) bandIndex++;
    }
    bands[bandIndex].push(item);
  }

  return bands.filter((band) => band.length > 0);
}
