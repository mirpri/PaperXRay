import { beforeEach, describe, expect, it } from "vitest";
import { clusterLines } from "./lines.js";
import { makeItem, resetItemIndex } from "./test-utils.js";

beforeEach(resetItemIndex);

describe("clusterLines", () => {
  it("groups items at the same y into one line, ordered left to right", () => {
    const items = [
      makeItem("world", 100, 700, 40, 10),
      makeItem("hello", 50, 700, 40, 10),
    ];
    const lines = clusterLines(items, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0].items.map((i) => i.str)).toEqual(["hello", "world"]);
  });

  it("tolerates small baseline jitter within a fraction of font size", () => {
    // fontSize 10 -> tolerance 4; 2px jitter should still merge.
    const items = [makeItem("a", 0, 700, 10, 10), makeItem("b", 20, 698, 10, 10)];
    const lines = clusterLines(items, 1);
    expect(lines).toHaveLength(1);
  });

  it("splits into separate lines once y difference exceeds tolerance", () => {
    const items = [makeItem("top", 0, 700, 20, 10), makeItem("bottom", 0, 650, 20, 10)];
    const lines = clusterLines(items, 1);
    expect(lines).toHaveLength(2);
  });

  it("orders lines top-to-bottom (descending y) regardless of input order", () => {
    const items = [makeItem("bottom", 0, 600, 20, 10), makeItem("top", 0, 700, 20, 10)];
    const lines = clusterLines(items, 1);
    expect(lines.map((l) => lineTextOf(l))).toEqual(["top", "bottom"]);
  });

  it("preserves each item's original itemIndex for CharMap alignment", () => {
    const items = [makeItem("a", 0, 700, 10, 10), makeItem("b", 20, 700, 10, 10)];
    const lines = clusterLines(items, 1);
    expect(lines[0].items.map((i) => i.itemIndex)).toEqual([0, 1]);
  });

  it("returns an empty array for a page with no text items", () => {
    expect(clusterLines([], 1)).toEqual([]);
  });
});

function lineTextOf(line: { items: { str: string }[] }): string {
  return line.items.map((i) => i.str).join("");
}
