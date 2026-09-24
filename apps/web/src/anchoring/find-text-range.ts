import type { CharRange, Node as IrNode } from "@paper-xray/contracts";
import { codePointLength, toCodePoints } from "@paper-xray/contracts";

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
 * This does NOT handle a selection that crosses a two-column page's
 * reading-order reordering (../../apps/server/src/reassembly/columns.ts) —
 * the visually-selected text and normalizedText's reading order can
 * genuinely diverge there, which is a real limitation, not a whitespace
 * mismatch.
 */
export function findTextRange(normalizedText: string, selectedText: string): CharRange | null {
  const trimmedSelected = selectedText.trim();
  if (trimmedSelected.length === 0) return null;

  const { collapsed: hay, spans } = collapseWhitespace(normalizedText);
  const { collapsed: needle } = collapseWhitespace(trimmedSelected);
  if (needle.length === 0) return null;

  const utf16Start = hay.indexOf(needle);
  if (utf16Start === -1) return null;

  const collapsedStart = codePointLength(hay.slice(0, utf16Start));
  const collapsedEnd = collapsedStart + codePointLength(needle);

  return { start: spans[collapsedStart][0], end: spans[collapsedEnd - 1][1] };
}

/** First node whose charRange contains `charStart`, or null if the selection landed in a gap (e.g. an inter-paragraph separator) between nodes. */
export function findContainingNode(nodes: IrNode[], charStart: number): IrNode | null {
  return nodes.find((n) => charStart >= n.charRange.start && charStart < n.charRange.end) ?? null;
}
