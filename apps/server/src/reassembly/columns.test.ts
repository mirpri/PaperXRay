import { beforeEach, describe, expect, it } from "vitest";
import { assemblePageLines } from "./columns.js";
import { lineText } from "./lines.js";
import { makeItem, resetItemIndex } from "./test-utils.js";

beforeEach(resetItemIndex);

const PAGE_WIDTH = 600;

describe("assemblePageLines", () => {
  it("splits a two-column page into header -> left column -> right column, in reading order", () => {
    const header = makeItem("Title spans the whole page width", 50, 800, 470, 10);

    // The gap between the header and the body is large enough that
    // splitIntoBands puts the header in its own band (correctly — it's not
    // part of the two-column flow), so the body needs its own >= 6 raw
    // lines to meet the column-detection evidence threshold.
    const rowYs = [700, 688, 676, 664, 652, 640];
    const leftRows = rowYs.map((y, i) => makeItem(`L${i + 1}`, 50, y, 200, 10));
    const rightRows = rowYs.map((y, i) => makeItem(`R${i + 1}`, 320, y, 200, 10));

    const lines = assemblePageLines([header, ...leftRows, ...rightRows], 1, PAGE_WIDTH);

    expect(lines.map(lineText)).toEqual([
      "Title spans the whole page width",
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
      "L6",
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
    ]);
  });

  it("leaves a single-column page untouched when there's no consistent gap", () => {
    const items = [700, 688, 676, 664, 652, 640].map((y, i) => makeItem(`line ${i + 1} of body text`, 50, y, 400, 10));

    const lines = assemblePageLines(items, 1, PAGE_WIDTH);

    expect(lines.map(lineText)).toEqual(items.map((i) => i.str));
  });

  it("does not attempt column detection with too few items to be confident", () => {
    const leftRows = [700, 688].map((y, i) => makeItem(`L${i + 1}`, 50, y, 200, 10));
    const rightRows = [700, 688].map((y, i) => makeItem(`R${i + 1}`, 320, y, 200, 10));

    const lines = assemblePageLines([...leftRows, ...rightRows], 1, PAGE_WIDTH);

    // Fewer than MIN_ITEMS_FOR_COLUMN_DETECTION items -> falls back to
    // plain clustering, which merges same-y left/right items into one line.
    expect(lines).toHaveLength(2);
    expect(lineText(lines[0])).toBe("L1 R1");
  });

  it("keeps a full-width line intact even when pdfjs splits it into several separate items (e.g. a running footer)", () => {
    const rowYs = [700, 688, 676, 664, 652, 640];
    const leftRows = rowYs.map((y, i) => makeItem(`L${i + 1}`, 50, y, 200, 10));
    const rightRows = rowYs.map((y, i) => makeItem(`R${i + 1}`, 320, y, 200, 10));

    // A footer rendered as 3 separate text items (e.g. a font/style change
    // mid-line) that together span the full width — none of them
    // individually straddles the boundary, but the *line* as a whole does,
    // with no real gap at the boundary position.
    const footerPart1 = makeItem("Conference Name", 50, 20, 90, 8);
    const footerPart2 = makeItem("Proceedings", 145, 20, 90, 8);
    const footerPart3 = makeItem("Page 12", 240, 20, 60, 8);

    const lines = assemblePageLines(
      [...leftRows, ...rightRows, footerPart1, footerPart2, footerPart3],
      1,
      PAGE_WIDTH,
    );

    const footerLine = lines.find((l) => lineText(l).includes("Conference Name"));
    expect(footerLine).toBeDefined();
    expect(lineText(footerLine!)).toBe("Conference Name Proceedings Page 12");
  });

  it("splits into left-then-right column order even when the two columns' line baselines don't align row-by-row", () => {
    // Real justified/hyphenated text rarely has left and right column lines
    // at exactly the same y — line-break points differ per column. Offset
    // the right column's rows by more than clusterLines' merge tolerance
    // (fontSize * 0.4 = 4) so no left/right pair ever merges into one raw
    // line — this is the scenario the old per-merged-line-gap detection
    // strategy couldn't handle at all.
    const leftRows = [700, 688, 676, 664, 652, 640].map((y, i) => makeItem(`L${i + 1}`, 50, y, 200, 10));
    const rightRows = [706, 694, 682, 670, 658, 646].map((y, i) => makeItem(`R${i + 1}`, 320, y, 200, 10));

    const lines = assemblePageLines([...leftRows, ...rightRows], 1, PAGE_WIDTH);

    expect(lines.map(lineText)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6", "R1", "R2", "R3", "R4", "R5", "R6"]);
  });

  it("keeps a full-width figure between two two-column blocks from scrambling either block's reading order", () => {
    const rowYs1 = [900, 888, 876, 864, 852, 840];
    const block1Left = rowYs1.map((y, i) => makeItem(`L${i + 1}`, 50, y, 200, 10));
    const block1Right = rowYs1.map((y, i) => makeItem(`R${i + 1}`, 320, y, 200, 10));

    // Large gap (140 vs a typical ~12) between block1 and the figure, and
    // again between the figure and block2 — each should start a new band.
    const figureCaption = makeItem("Figure 1: chaotic caption layout", 150, 700, 250, 8);

    const rowYs2 = [600, 588, 576, 564, 552, 540];
    const block2Left = rowYs2.map((y, i) => makeItem(`M${i + 1}`, 50, y, 200, 10));
    const block2Right = rowYs2.map((y, i) => makeItem(`N${i + 1}`, 320, y, 200, 10));

    const lines = assemblePageLines(
      [...block1Left, ...block1Right, figureCaption, ...block2Left, ...block2Right],
      1,
      PAGE_WIDTH,
    );

    expect(lines.map(lineText)).toEqual([
      "L1", "L2", "L3", "L4", "L5", "L6",
      "R1", "R2", "R3", "R4", "R5", "R6",
      "Figure 1: chaotic caption layout",
      "M1", "M2", "M3", "M4", "M5", "M6",
      "N1", "N2", "N3", "N4", "N5", "N6",
    ]);
  });

  it("does not split on a gap that only shows up on a minority of lines", () => {
    // 6 raw lines, only 1 has a wide central gap -> below the 40% agreement threshold.
    const items = [
      makeItem("full width line one", 50, 700, 470, 10),
      makeItem("L", 50, 688, 200, 10),
      makeItem("R", 320, 688, 200, 10),
      makeItem("full width line three", 50, 676, 470, 10),
      makeItem("full width line four", 50, 664, 470, 10),
      makeItem("full width line five", 50, 652, 470, 10),
      makeItem("full width line six", 50, 640, 470, 10),
    ];

    const lines = assemblePageLines(items, 1, PAGE_WIDTH);
    expect(lines).toHaveLength(6);
  });
});
