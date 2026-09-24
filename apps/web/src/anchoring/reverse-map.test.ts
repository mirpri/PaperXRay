import { describe, expect, it } from "vitest";
import type { CharMap } from "@paper-xray/contracts";
import { mapCharRangeToRects, type ItemGeometry } from "./reverse-map.js";

const GEOMETRIES: Record<string, ItemGeometry> = {
  "1:0": { x: 0, y: 700, width: 100, height: 12 },
  "1:1": { x: 0, y: 680, width: 60, height: 12 },
  "2:0": { x: 0, y: 700, width: 80, height: 12 },
};

function getGeometry(page: number, itemIndex: number): ItemGeometry | undefined {
  return GEOMETRIES[`${page}:${itemIndex}`];
}

describe("mapCharRangeToRects", () => {
  it("returns one full-width rect for a range covering exactly one whole run", () => {
    const charMap: CharMap = [{ charStart: 0, charEnd: 10, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 }];
    const rects = mapCharRangeToRects({ start: 0, end: 10 }, charMap, getGeometry);
    expect(rects).toEqual([{ page: 1, x: 0, y: 700, width: 100, height: 12 }]);
  });

  it("returns a proportional sub-rect for a range covering only part of a run", () => {
    const charMap: CharMap = [{ charStart: 0, charEnd: 10, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 }];
    // last half of the 10-char run -> right half of the 100pt-wide item
    const rects = mapCharRangeToRects({ start: 5, end: 10 }, charMap, getGeometry);
    expect(rects).toEqual([{ page: 1, x: 50, y: 700, width: 50, height: 12 }]);
  });

  it("returns one rect per run for a range spanning multiple runs/items", () => {
    const charMap: CharMap = [
      { charStart: 0, charEnd: 10, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 },
      { charStart: 11, charEnd: 17, page: 1, itemIndex: 1, itemCharStart: 0, itemCharEnd: 6 }, // gap at 10 = inserted space
    ];
    const rects = mapCharRangeToRects({ start: 0, end: 17 }, charMap, getGeometry);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ page: 1, x: 0, y: 700, width: 100, height: 12 });
    expect(rects[1]).toEqual({ page: 1, x: 0, y: 680, width: 60, height: 12 });
  });

  it("skips runs the range doesn't overlap at all", () => {
    const charMap: CharMap = [
      { charStart: 0, charEnd: 10, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 },
      { charStart: 11, charEnd: 17, page: 1, itemIndex: 1, itemCharStart: 0, itemCharEnd: 6 },
    ];
    const rects = mapCharRangeToRects({ start: 0, end: 10 }, charMap, getGeometry);
    expect(rects).toHaveLength(1);
  });

  it("skips a run whose item geometry is unavailable rather than throwing", () => {
    const charMap: CharMap = [{ charStart: 0, charEnd: 10, page: 99, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 }];
    const rects = mapCharRangeToRects({ start: 0, end: 10 }, charMap, getGeometry);
    expect(rects).toEqual([]);
  });

  it("sorts results by page then x", () => {
    const charMap: CharMap = [
      { charStart: 20, charEnd: 30, page: 2, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 },
      { charStart: 0, charEnd: 10, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 },
    ];
    const rects = mapCharRangeToRects({ start: 0, end: 30 }, charMap, getGeometry);
    expect(rects.map((r) => r.page)).toEqual([1, 2]);
  });

  it("returns an empty array for a range with no overlapping runs", () => {
    const charMap: CharMap = [{ charStart: 0, charEnd: 10, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 }];
    const rects = mapCharRangeToRects({ start: 100, end: 110 }, charMap, getGeometry);
    expect(rects).toEqual([]);
  });
});
