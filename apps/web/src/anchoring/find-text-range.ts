import type { CharRange, Node as IrNode } from "@paper-xray/contracts";
import { codePointLength, toCodePoints } from "@paper-xray/contracts";
import type { CharMap } from "@paper-xray/contracts";

/**
 * Splits `s` into a whitespace-collapsed string (every run of whitespace ->
 * one space) plus, for each collapsed character, the [start, end) code-point
 * span of `s` it came from. Selected text from react-pdf-highlighter comes
 * from pdf.js's own text-layer DOM (its own rules for inserting spaces
 * between items/lines), which routinely disagrees on *whitespace* with our
 * own reassembly's joining (build-document.ts) even when both describe the
 * exact same visible words — collapsing whitespace before matching absorbs
 * that without caring which side has more/fewer spaces or newlines.
 */
function collapseWhitespace(s: string): { collapsed: string; spans: Array<[number, number]> } {
  const codePoints = toCodePoints(s);
  let collapsed = "";
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < codePoints.length) {
    if (/\s/.test(codePoints[i])) {
      let j = i + 1;
      while (j < codePoints.length && /\s/.test(codePoints[j])) j++;
      collapsed += " ";
      spans.push([i, j]);
      i = j;
    } else {
      collapsed += codePoints[i];
      spans.push([i, i + 1]);
      i++;
    }
  }
  return { collapsed, spans };
}

/**
 * Locates a literal text selection (from react-pdf-highlighter's
 * onSelectionFinished, which gives back plain selected text, not a
 * CharRange) inside normalizedText. Whitespace is normalized on both sides
 * before matching (see collapseWhitespace) — the match is then mapped back
 * to genuine code-point offsets into the *original* normalizedText
 * (docs/02-decisions.md #12: CharRange is always code-point-counted, never
 * UTF-16 units, and never a whitespace-collapsed proxy string).
 *
 * When `positionHint` is provided (page number and approximate character
 * offset from PDF coordinates), the function searches for the occurrence
 * closest to that hint rather than always returning the first match. This
 * fixes the bug where selecting "1" in one section would highlight "1" in
 * a different section above it.
 *
 * This does NOT handle a selection that crosses a two-column page's
 * reading-order reordering (../../apps/server/src/reassembly/columns.ts) —
 * the visually-selected text and normalizedText's reading order can
 * genuinely diverge there, which is a real limitation, not a whitespace
 * mismatch.
 */
export function findTextRange(
  normalizedText: string,
  selectedText: string,
  positionHint?: { page: number; charOffset: number; pageRange?: CharRange },
): CharRange | null {
  const trimmedSelected = selectedText.trim();
  if (trimmedSelected.length === 0) return null;

  const { collapsed: hay, spans } = collapseWhitespace(normalizedText);
  const { collapsed: needle } = collapseWhitespace(trimmedSelected);
  if (needle.length === 0) return null;

  // Find all occurrences of the needle
  const occurrences: number[] = [];
  let searchStart = 0;
  while (searchStart < hay.length) {
    const utf16Start = hay.indexOf(needle, searchStart);
    if (utf16Start === -1) break;
    const charStart = spans[codePointLength(hay.slice(0, utf16Start))][0];
    if (!positionHint?.pageRange ||
        (charStart >= positionHint.pageRange.start && charStart < positionHint.pageRange.end)) {
      occurrences.push(utf16Start);
    }
    searchStart = utf16Start + 1;
  }

  if (occurrences.length === 0) return null;

  // If no position hint, use the first occurrence (backward compatibility)
  let utf16Start: number;
  if (!positionHint || occurrences.length === 1) {
    utf16Start = occurrences[0];
  } else {
    // Find the occurrence closest to the position hint
    let bestOccurrence = occurrences[0];
    let bestDistance = Infinity;

    for (const occ of occurrences) {
      const collapsedStart = codePointLength(hay.slice(0, occ));
      const charStart = spans[collapsedStart][0];
      const distance = Math.abs(charStart - positionHint.charOffset);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOccurrence = occ;
      }
    }
    utf16Start = bestOccurrence;
  }

  const collapsedStart = codePointLength(hay.slice(0, utf16Start));
  const collapsedEnd = collapsedStart + codePointLength(needle);

  return { start: spans[collapsedStart][0], end: spans[collapsedEnd - 1][1] };
}

/**
 * Estimates the character offset in normalizedText for a given PDF position
 * using the charMap. This provides a hint for disambiguating multiple
 * occurrences of the same text.
 */
export function estimateCharOffsetFromPosition(
  charMap: CharMap,
  page: number,
  x: number,
  y: number,
  getItemGeometry: (page: number, itemIndex: number) => { x: number; y: number; width: number; height: number } | undefined,
): number | null {
  // Find the charMap run closest to the given position on the given page
  let bestOffset: number | null = null;
  let bestDistance = Infinity;

  for (const run of charMap) {
    if (run.page !== page) continue;

    const geometry = getItemGeometry(run.page, run.itemIndex);
    if (!geometry) continue;

    // Distance to the box, rather than its center: a long text item can
    // contain the selection even when another item's center is closer.
    const dx = Math.max(geometry.x - x, 0, x - geometry.x - geometry.width);
    const dy = Math.max(geometry.y - y, 0, y - geometry.y - geometry.height);
    const distance = Math.hypot(dx, dy);

    if (distance < bestDistance) {
      bestDistance = distance;
      const fraction = geometry.width > 0 ? Math.max(0, Math.min(1, (x - geometry.x) / geometry.width)) : 0;
      bestOffset = Math.min(run.charEnd - 1,
        run.charStart + Math.floor(fraction * (run.charEnd - run.charStart)));
    }
  }

  return bestOffset;
}

/** First node whose charRange contains `charStart`, or null if the selection landed in a gap (e.g. an inter-paragraph separator) between nodes. */
export function findContainingNode(nodes: IrNode[], charStart: number): IrNode | null {
  return nodes.find((n) => charStart >= n.charRange.start && charStart < n.charRange.end) ?? null;
}
