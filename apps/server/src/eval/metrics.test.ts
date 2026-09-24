import { describe, expect, it } from "vitest";
import { charMapCoverage, checkAnchor, findCollapsed, matchSpans, readingOrderScore, sampleAnchors } from "./metrics.js";

describe("findCollapsed", () => {
  it("ignores whitespace differences and returns code-point offsets", () => {
    expect(findCollapsed("𝑥 a  b\nc", "b c")).toBe(5);
    expect(findCollapsed("abc", "zz")).toBe(-1);
  });
});

describe("readingOrderScore", () => {
  it("counts found snippets and the longest in-order run", () => {
    const text = "one two three four five";
    const r = readingOrderScore(text, ["one", "four", "three", "five", "six"]);
    expect(r).toMatchObject({ total: 5, found: 4, inOrder: 3, missing: ["six"] });
    expect(r.outOfOrder).toHaveLength(1);
  });
});

describe("charMapCoverage", () => {
  it("counts only non-whitespace code points", () => {
    const run = { page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 2 };
    expect(charMapCoverage("ab cd", [{ ...run, charStart: 0, charEnd: 2 }])).toEqual({ mapped: 2, total: 4 });
  });
});

describe("checkAnchor", () => {
  const text = "The quick brown fox jumps over the lazy dog.";
  const [snap] = sampleAnchors(text, 1, 10, 5);

  it("is stable when the range still holds the same text", () => {
    expect(checkAnchor(text, snap)).toBe("stable");
  });

  it("is relocated when the text moved", () => {
    expect(checkAnchor(`Intro. ${text}`, snap)).toBe("relocated");
  });

  it("is lost when the text is gone", () => {
    expect(checkAnchor("Something else entirely, nothing in common here at all.", snap)).toBe("lost");
  });
});

describe("matchSpans", () => {
  it("matches one-to-one on overlap of the shorter span", () => {
    const r = matchSpans(
      [
        { start: 0, end: 10 },
        { start: 2, end: 8 },
        { start: 50, end: 60 },
      ],
      [
        { start: 3, end: 9 },
        { start: 100, end: 110 },
      ],
    );
    expect(r.truePositives).toBe(1);
    expect(r.precision).toBeCloseTo(1 / 3);
    expect(r.recall).toBeCloseTo(1 / 2);
  });

  it("returns zeros rather than NaN for empty inputs", () => {
    expect(matchSpans([], [])).toMatchObject({ precision: 0, recall: 0, f1: 0 });
  });
});
