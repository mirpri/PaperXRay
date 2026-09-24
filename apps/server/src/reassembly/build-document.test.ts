import { describe, expect, it } from "vitest";
import { sliceByCodePoints } from "@paper-xray/contracts";
import { buildDocument } from "./build-document.js";
import { makeItem, resetItemIndex } from "./test-utils.js";

describe("buildDocument", () => {
  it("assembles normalizedText, a round-trippable CharMap, and one paragraph Node per paragraph", () => {
    resetItemIndex();
    const page1Items = [makeItem("Hello world", 50, 700, 100, 10), makeItem("second line.", 50, 688, 90, 10)];

    resetItemIndex(); // itemIndex is page-scoped, like pdfjs-dist's own getTextContent().items
    const page2Items = [makeItem("Another paragraph.", 50, 700, 150, 10)];

    const { normalizedText, charMap, nodes } = buildDocument(
      [
        { width: 600, height: 800, items: page1Items },
        { width: 600, height: 800, items: page2Items },
      ],
      "test-content-hash",
    );

    // Two paragraphs: page1's ends with terminal punctuation, so it must
    // NOT be cross-page-merged into page2's.
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.type === "paragraph")).toBe(true);

    const paragraphText = (n: (typeof nodes)[number]) =>
      sliceByCodePoints(normalizedText, n.charRange.start, n.charRange.end);
    expect(paragraphText(nodes[0])).toBe("Hello world\nsecond line.");
    expect(paragraphText(nodes[1])).toBe("Another paragraph.");

    // Every CharMap run must round-trip: the text it claims to cover must
    // actually be there. This is the property the whole project's anchoring
    // depends on (docs/01-nabcd-architecture.md "CharMap 是整个项目的枢纽").
    for (const run of charMap) {
      const covered = sliceByCodePoints(normalizedText, run.charStart, run.charEnd);
      expect(covered.length).toBe(run.charEnd - run.charStart);
      expect(run.page).toBeGreaterThanOrEqual(1);
    }

    // Page-scoped itemIndex: both pages' first item is itemIndex 0.
    const page1Runs = charMap.filter((r) => r.page === 1);
    const page2Runs = charMap.filter((r) => r.page === 2);
    expect(page1Runs.map((r) => r.itemIndex)).toEqual([0, 1]);
    expect(page2Runs.map((r) => r.itemIndex)).toEqual([0]);

    // Node ids are stable content-derived hashes, not e.g. array indices.
    expect(nodes[0].id).not.toBe(nodes[1].id);
    expect(nodes[0].id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns no nodes for a document with no extractable text", () => {
    const { normalizedText, charMap, nodes } = buildDocument(
      [{ width: 600, height: 800, items: [] }],
      "test-content-hash",
    );
    expect(normalizedText).toBe("");
    expect(charMap).toEqual([]);
    expect(nodes).toEqual([]);
  });

  it("gives two documents with identical paragraph text different node ids (regression: nodes.id is a bare PRIMARY KEY, not scoped to doc_id)", () => {
    resetItemIndex();
    const items = [makeItem("Same title text", 50, 700, 100, 10)];
    const a = buildDocument([{ width: 600, height: 800, items }], "content-hash-a");

    resetItemIndex();
    const itemsAgain = [makeItem("Same title text", 50, 700, 100, 10)];
    const b = buildDocument([{ width: 600, height: 800, items: itemsAgain }], "content-hash-b");

    expect(a.nodes[0].id).not.toBe(b.nodes[0].id);
  });
});
