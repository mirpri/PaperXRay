import { describe, expect, it } from "vitest";
import { findEvidenceRange, parseLensModelOutput, sanitizeLensItems } from "./lens-output.js";

describe("parseLensModelOutput", () => {
  it("parses fenced JSON and normalizes fields", () => {
    const raw = '```json\n{"annotations":[{"evidenceText":"abc","comment":"c","severity":"bogus","confidence":7}]}\n```';
    expect(parseLensModelOutput(raw, 5)).toEqual([{ evidenceText: "abc", comment: "c", severity: "info", confidence: 1 }]);
  });

  it("returns [] for non-JSON", () => {
    expect(parseLensModelOutput("sorry, I can't", 5)).toEqual([]);
  });
});

describe("sanitizeLensItems", () => {
  it("drops malformed items and caps the count", () => {
    const items = [
      { evidenceText: "a", comment: "x", severity: "high", confidence: 0.4 },
      { evidenceText: "", comment: "x" },
      { evidenceText: "b" },
      "junk",
      { evidenceText: "c", comment: "y", severity: "low", confidence: "0.3" },
      { evidenceText: "d", comment: "z" },
    ];
    expect(sanitizeLensItems(items, 2)).toEqual([
      { evidenceText: "a", comment: "x", severity: "high", confidence: 0.4 },
      { evidenceText: "c", comment: "y", severity: "low", confidence: 0.3 },
    ]);
  });
});

describe("findEvidenceRange", () => {
  it("returns code-point offsets, not UTF-16 offsets", () => {
    const text = "𝑥 = 1. The model overfits.";
    // "𝑥" is one code point but two UTF-16 units.
    expect(findEvidenceRange(text, "The model")).toEqual({ start: 7, end: 16 });
  });

  it("returns null for a non-verbatim quote", () => {
    expect(findEvidenceRange("hello world", "hello  world")).toBeNull();
  });
});
