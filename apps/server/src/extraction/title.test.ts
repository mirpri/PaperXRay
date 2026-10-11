import { describe, expect, it } from "vitest";
import { extractTitle } from "./title.js";
import type { PageExtraction, RawTextItem } from "./types.js";

const item = (str: string, y: number, fontSize = 10, x = 60): RawTextItem => ({
  str, y, fontSize, x, width: str.length * fontSize / 2, height: fontSize, fontName: "font", itemIndex: 0,
});
const page: PageExtraction = { width: 600, height: 800, items: [
  item("Conference proceedings", 775, 10),
  item("Understanding Paper", 700, 22), item("Reading Systems", 674, 22),
  item("Alice and Bob", 635, 12), item("Abstract", 580, 12),
  item("A long paragraph of normal body text about this research paper and its results.", 460),
  item("More body text describing the detailed methods and evaluation.", 440),
] };

describe("document title extraction", () => {
  it("prefers a valid metadata title and normalizes whitespace", () => {
    expect(extractTitle(["  A\nResearch   Title  "], page, "paper.pdf")).toBe("A Research Title");
    expect(extractTitle(["", "论文标题"], page)).toBe("论文标题");
  });
  it.each([null, 42, "Untitled", "Microsoft Word - draft", "paper.pdf", "paper", "https://example.org/paper"])("ignores unsuitable metadata %j and merges title lines", value => {
    expect(extractTitle([value], page, "paper.pdf")).toBe("Understanding Paper Reading Systems");
  });
  it("ignores vertical margin text, large footer text, authors and normal body text", () => {
    const variant = { ...page, items: [...page.items,
      { ...item("arXiv:2026.00123", 720, 28), width: 28, height: 200 },
      item("Publisher", 20, 40),
    ] };
    expect(extractTitle([], variant)).toBe("Understanding Paper Reading Systems");
  });
  it("does not extend a title across a large vertical gap", () => {
    expect(extractTitle([], { ...page, items: [...page.items, item("A Separate Heading", 550, 22)] })).toBe("Understanding Paper Reading Systems");
  });
  it("falls back to the filename for empty, scanned or uniform-size pages", () => {
    expect(extractTitle([], undefined, "scan.pdf")).toBe("scan.pdf");
    expect(extractTitle([], { ...page, items: [] }, "scan.pdf")).toBe("scan.pdf");
    expect(extractTitle([], { ...page, items: page.items.map(i => ({ ...i, fontSize: 10 })) }, "paper.pdf")).toBe("paper.pdf");
    expect(extractTitle([], undefined)).toBeNull();
  });
  it("limits metadata and fallback titles to 500 Unicode characters", () => {
    expect(Array.from(extractTitle(["论".repeat(501)], undefined)!)).toHaveLength(500);
    expect(Array.from(extractTitle([], undefined, "😀".repeat(501))!)).toHaveLength(500);
  });
});
