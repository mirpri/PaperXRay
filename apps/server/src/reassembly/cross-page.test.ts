import { beforeEach, describe, expect, it } from "vitest";
import { mergeCrossPageParagraphs } from "./cross-page.js";
import { makeLine, resetItemIndex } from "./test-utils.js";

beforeEach(resetItemIndex);

describe("mergeCrossPageParagraphs", () => {
  it("joins a paragraph that ends full-width with no terminal punctuation to the next page's first paragraph", () => {
    const page1 = [{ lines: [makeLine(1, 100, 50, 490, 10, "the method continues onto the next page and")] }];
    const page2 = [{ lines: [makeLine(2, 700, 50, 300, 10, "concludes here.")] }];

    const merged = mergeCrossPageParagraphs([page1, page2]);

    expect(merged).toHaveLength(1);
    expect(merged[0].lines).toHaveLength(2);
  });

  it("does not join when the page ends with terminal punctuation", () => {
    const page1 = [{ lines: [makeLine(1, 100, 50, 490, 10, "this sentence ends here.")] }];
    const page2 = [{ lines: [makeLine(2, 700, 50, 300, 10, "A new paragraph starts here.")] }];

    const merged = mergeCrossPageParagraphs([page1, page2]);

    expect(merged).toHaveLength(2);
  });

  it("does not join when the last line falls well short of the column width", () => {
    const page1 = [{ lines: [makeLine(1, 100, 50, 200, 10, "short line")] }];
    const page2 = [{ lines: [makeLine(2, 700, 50, 300, 10, "unrelated new paragraph")] }];

    const merged = mergeCrossPageParagraphs([page1, page2]);

    expect(merged).toHaveLength(2);
  });

  it("passes through remaining paragraphs on the second page untouched", () => {
    const page1 = [{ lines: [makeLine(1, 100, 50, 490, 10, "continues and")] }];
    const page2 = [
      { lines: [makeLine(2, 700, 50, 300, 10, "concludes here.")] },
      { lines: [makeLine(2, 600, 50, 300, 10, "A separate second paragraph.")] },
    ];

    const merged = mergeCrossPageParagraphs([page1, page2]);

    expect(merged).toHaveLength(2);
    expect(merged[0].lines).toHaveLength(2);
    expect(merged[1].lines).toHaveLength(1);
  });
});
