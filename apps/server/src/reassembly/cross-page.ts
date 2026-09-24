import { lineText } from "./lines.js";
import type { Paragraph } from "./paragraphs.js";

const TERMINAL_PUNCTUATION = /[.!?。！？:;]\s*$/;

/**
 * Joins a paragraph split across a page boundary back together: if a page
 * ends on a full-width line with no terminal punctuation, its paragraph is
 * continued by the first paragraph of the next page (docs/01-nabcd-architecture.md
 * "三个关键技术难点" #1 step 5).
 */
export function mergeCrossPageParagraphs(pagesOfParagraphs: Paragraph[][]): Paragraph[] {
  // Column width must be judged against the whole document, not a single
  // (possibly one-line) paragraph — otherwise a short paragraph's own right
  // edge trivially equals its "column width" and every short paragraph
  // looks "full width".
  const columnRight = Math.max(
    0,
    ...pagesOfParagraphs.flatMap((paras) => paras.flatMap((p) => p.lines.map((l) => l.maxX))),
  );

  const merged: Paragraph[] = [];

  for (const pageParagraphs of pagesOfParagraphs) {
    const [first, ...rest] = pageParagraphs;
    const prevParagraph = merged[merged.length - 1];

    if (prevParagraph && first && shouldJoin(prevParagraph, columnRight)) {
      prevParagraph.lines.push(...first.lines);
      merged.push(...rest);
    } else {
      merged.push(...pageParagraphs);
    }
  }

  return merged;
}

function shouldJoin(prev: Paragraph, columnRight: number): boolean {
  const lastLine = prev.lines[prev.lines.length - 1];
  const text = lineText(lastLine).trim();
  if (!text || TERMINAL_PUNCTUATION.test(text)) return false;

  const fullWidth = columnRight - lastLine.maxX < lastLine.fontSize * 2;
  return fullWidth;
}
