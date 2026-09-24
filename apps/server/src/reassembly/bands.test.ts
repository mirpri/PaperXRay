import { beforeEach, describe, expect, it } from "vitest";
import { splitIntoBands } from "./bands.js";
import { makeItem, resetItemIndex } from "./test-utils.js";

beforeEach(resetItemIndex);

describe("splitIntoBands", () => {
  it("keeps evenly-spaced lines as a single band", () => {
    const items = [700, 688, 676, 664, 652].map((y) => makeItem("line", 50, y, 200, 10));
    expect(splitIntoBands(items)).toHaveLength(1);
  });

  it("splits on a gap much larger than the typical line spacing (e.g. a figure)", () => {
    const above = [700, 688, 676, 664].map((y) => makeItem("text above", 50, y, 200, 10));
    // typical gap here is 12; a gap of 100 (a figure block) should trigger a split.
    const below = [560, 548, 536].map((y) => makeItem("text below", 50, y, 200, 10));

    const bands = splitIntoBands([...above, ...below]);

    expect(bands).toHaveLength(2);
    expect(bands[0]).toHaveLength(4);
    expect(bands[1]).toHaveLength(3);
  });

  it("does not split on ordinary paragraph-break-sized gaps", () => {
    // Gaps of 12 (line) vs ~20 (paragraph break) shouldn't count as a band break.
    const items = [
      makeItem("a", 50, 700, 200, 10),
      makeItem("b", 50, 688, 200, 10),
      makeItem("c", 50, 668, 200, 10), // paragraph gap, still well under 4x typical
      makeItem("d", 50, 656, 200, 10),
    ];
    expect(splitIntoBands(items)).toHaveLength(1);
  });

  it("returns the items untouched (as one band) for fewer than 3 lines", () => {
    const items = [makeItem("a", 50, 700, 200, 10), makeItem("b", 50, 500, 200, 10)];
    const bands = splitIntoBands(items);
    expect(bands).toEqual([items]);
  });

  it("returns an empty array for no items", () => {
    expect(splitIntoBands([])).toEqual([]);
  });
});
