import { describe, expect, it } from "vitest";
import { codePointLength, sliceByCodePoints, toCodePoints } from "./codepoints.js";

describe("codepoints", () => {
  it("counts astral-plane characters (surrogate pairs) as one code point", () => {
    // U+1D400 MATHEMATICAL BOLD CAPITAL A is a surrogate pair in UTF-16.
    const s = "a\u{1D400}b";
    expect(s.length).toBe(4); // UTF-16 code units: a, hi, lo, b
    expect(codePointLength(s)).toBe(3); // code points: a, MATHEMATICAL BOLD CAPITAL A, b
  });

  it("splits into one array entry per code point", () => {
    const s = "x\u{1D400}y";
    expect(toCodePoints(s)).toEqual(["x", "\u{1D400}", "y"]);
  });

  it("slices by code-point offsets, not UTF-16 offsets", () => {
    const s = "x\u{1D400}y";
    // str[1] would return an unpaired surrogate; this must return the full character.
    expect(sliceByCodePoints(s, 1, 2)).toBe("\u{1D400}");
    expect(sliceByCodePoints(s, 0, 2)).toBe("x\u{1D400}");
  });

  it("handles CJK text (BMP, so code points == UTF-16 units, but must not regress)", () => {
    const s = "论文透视";
    expect(codePointLength(s)).toBe(4);
    expect(sliceByCodePoints(s, 1, 3)).toBe("文透");
  });
});
