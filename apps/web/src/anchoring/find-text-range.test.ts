import { describe, expect, it } from "vitest";
import type { Node as IrNode } from "@paper-xray/contracts";
import { findContainingNode, findTextRange, selectionRectsToRanges } from "./find-text-range.js";

describe("findTextRange", () => {
  it("finds a literal substring and returns code-point offsets", () => {
    const text = "The method section describes our approach.";
    expect(findTextRange(text, "method section")).toEqual({ start: 4, end: 18 });
  });

  it("returns null when the text isn't a substring", () => {
    expect(findTextRange("abc", "xyz")).toBeNull();
  });

  it("accounts for astral code points before the match", () => {
    // U+1F600 is a surrogate pair in UTF-16 but one code point.
    const text = "\u{1F600}\u{1F600}hello world";
    expect(findTextRange(text, "world")).toEqual({ start: 8, end: 13 });
  });

  it("matches across a newline in normalizedText vs. a space in the selection", () => {
    // pdf.js's text-layer selection often collapses a line break to a single
    // space where our own reassembly inserted "\n" (build-document.ts).
    const text = "first line\nsecond line";
    const range = findTextRange(text, "first line second line");
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end)).toBe("first line\nsecond line");
  });

  it("matches when the selection has extra/collapsed whitespace the source text doesn't", () => {
    const text = "alpha beta gamma";
    const range = findTextRange(text, "alpha   beta"); // selection has 3 spaces, source has 1
    expect(range).toEqual({ start: 0, end: 10 });
  });

  it("trims leading/trailing whitespace from the selection before matching", () => {
    const text = "alpha beta gamma";
    expect(findTextRange(text, "  beta  ")).toEqual({ start: 6, end: 10 });
  });
});

describe("selectionRectsToRanges", () => {
  it("keeps both columns without selecting intervening unselected text", () => {
    const text = "left\nother\nright";
    const charMap = [
      { charStart: 0, charEnd: 4, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 4 },
      { charStart: 5, charEnd: 10, page: 1, itemIndex: 1, itemCharStart: 0, itemCharEnd: 5 },
      { charStart: 11, charEnd: 16, page: 1, itemIndex: 2, itemCharStart: 0, itemCharEnd: 5 },
    ];
    const geometries = [
      { x: 0, y: 700, width: 40, height: 10 },
      { x: 0, y: 680, width: 50, height: 10 },
      { x: 100, y: 700, width: 50, height: 10 },
    ];
    expect(selectionRectsToRanges(text, [{ page: 1, x: 0, y: 700, width: 150, height: 10 }], charMap,
      (_page, index) => geometries[index])).toEqual([{ start: 0, end: 4 }, { start: 11, end: 16 }]);
  });

  it("merges overlapping rectangles and whitespace-separated text across pages", () => {
    const charMap = [
      { charStart: 0, charEnd: 4, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 4 },
      { charStart: 6, charEnd: 10, page: 2, itemIndex: 0, itemCharStart: 0, itemCharEnd: 4 },
    ];
    const rect = { page: 1, x: 0, y: 700, width: 40, height: 10 };
    expect(selectionRectsToRanges("left\n\nnext", [rect, rect, { ...rect, page: 2 }], charMap,
      () => ({ x: 0, y: 700, width: 40, height: 10 }))).toEqual([{ start: 0, end: 10 }]);
  });
});

describe("findContainingNode", () => {
  const nodes: IrNode[] = [
    { id: "n1", type: "paragraph", parentId: null, order: 0, charRange: { start: 0, end: 10 }, pageHint: 1 },
    { id: "n2", type: "paragraph", parentId: null, order: 1, charRange: { start: 12, end: 20 }, pageHint: 1 },
  ];

  it("finds the node containing a given offset", () => {
    expect(findContainingNode(nodes, 5)?.id).toBe("n1");
    expect(findContainingNode(nodes, 15)?.id).toBe("n2");
  });

  it("returns null for an offset in a gap between nodes", () => {
    expect(findContainingNode(nodes, 11)).toBeNull();
  });
});
