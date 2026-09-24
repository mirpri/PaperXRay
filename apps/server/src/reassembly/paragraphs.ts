import type { Line } from "./lines.js";

export interface Paragraph {
  lines: Line[];
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Segments a page's lines into paragraphs using the three heuristics from
 * docs/01-nabcd-architecture.md "三个关键技术难点" #1 step 3:
 * first-line indent, a line-spacing jump, and the previous line's right
 * edge falling well short of the column width (signals the previous line
 * ended a paragraph rather than wrapping).
 */
export function segmentParagraphs(lines: Line[]): Paragraph[] {
  if (lines.length === 0) return [];

  const baselineLeft = median(lines.map((l) => l.minX));
  const columnRight = Math.max(...lines.map((l) => l.maxX));
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0);
  const typicalGap = gaps.length > 0 ? median(gaps) : lines[0].fontSize * 1.2;

  const paragraphs: Paragraph[] = [{ lines: [lines[0]] }];

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];

    const indented = curr.minX - baselineLeft > curr.fontSize * 0.8;
    const bigGap = prev.y - curr.y > typicalGap * 1.6;
    const prevLineWasShort = columnRight - prev.maxX > prev.fontSize * 3;

    if (indented || bigGap || prevLineWasShort) {
      paragraphs.push({ lines: [curr] });
    } else {
      paragraphs[paragraphs.length - 1].lines.push(curr);
    }
  }

  return paragraphs;
}
