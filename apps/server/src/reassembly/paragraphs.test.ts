import { beforeEach, describe, expect, it } from "vitest";
import { segmentParagraphs } from "./paragraphs.js";
import { makeLine, resetItemIndex } from "./test-utils.js";

beforeEach(resetItemIndex);

describe("segmentParagraphs", () => {
  it("splits on indent, a big line-spacing jump, and a short-ended previous line — this page should cut into 4 paragraphs", () => {
    const lines = [
      makeLine(1, 700, 50, 490), // P1 L1
      makeLine(1, 688, 50, 470), // P1 L2
      makeLine(1, 676, 50, 200), // P1 L3 — short, ends paragraph 1
      makeLine(1, 664, 50, 480), // P2 L1 — starts because previous line was short
      makeLine(1, 580, 50, 470), // P3 L1 — starts because of a big gap (84 vs typical 12)
      makeLine(1, 568, 90, 490), // P4 L1 — starts because it's indented
      makeLine(1, 556, 50, 470), // P4 L2 — continues normally
      makeLine(1, 544, 50, 250), // P4 L3 — continues normally, itself ends short
    ];

    const paragraphs = segmentParagraphs(lines);

    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[0].lines).toHaveLength(3);
    expect(paragraphs[1].lines).toHaveLength(1);
    expect(paragraphs[2].lines).toHaveLength(1);
    expect(paragraphs[3].lines).toHaveLength(3);
  });

  it("keeps a single evenly-spaced, non-indented block as one paragraph", () => {
    const lines = [makeLine(1, 700, 50, 480), makeLine(1, 688, 50, 480), makeLine(1, 676, 50, 300)];
    expect(segmentParagraphs(lines)).toHaveLength(1);
  });

  it("returns an empty array for a page with no lines", () => {
    expect(segmentParagraphs([])).toEqual([]);
  });
});
