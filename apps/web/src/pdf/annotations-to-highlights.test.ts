import { expect, it } from "vitest";
import type { AgentAnnotation, CharMap, HumanAnnotation } from "@paper-xray/contracts";
import { lensColor } from "@paper-xray/contracts";
import { annotationsToHighlights } from "./annotations-to-highlights";
const anchor = { nodeId: "n", charRange: { start: 0, end: 10 }, contextPrefix: "", contextSuffix: "" };
const agent = { id: "a", agentId: "lens", anchor, comment: "Check", lensColor: "#168575" } as AgentAnnotation;
const charMap: CharMap = [{ charStart: 0, charEnd: 10, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 }];
const geometry = new Map([[1, new Map([[0, { x: 0, y: 700, width: 100, height: 12 }]])]]);
it("uses current catalog color for PDF highlights when available", () => {
  expect(annotationsToHighlights([agent], charMap, geometry, new Map([["lens", "#8056AF"]]))[0].color).toBe("#8056AF");
});
it("uses returned color for shared or deleted lenses outside the catalog", () => {
  expect(annotationsToHighlights([agent], charMap, geometry)[0].color).toBe("#168575");
});
it("uses a human annotation's custom underline color", () => {
  const note = { id: "h", authorId: "user", anchor, body: "Note", color: "#123abc" } as HumanAnnotation;
  expect(annotationsToHighlights([note], charMap, geometry)[0].color).toBe("#123ABC");
});
it("gives legacy lenses a stable palette fallback, and keeps human notes blue", () => {
  const legacy = { ...agent, lensColor: undefined };
  const human = { id: "h", authorId: "user", anchor, body: "Note" } as HumanAnnotation;
  expect(annotationsToHighlights([legacy, human], charMap, geometry).map(h => h.color)).toEqual([lensColor("lens"), "#40628C"]);
});

it("renders every selected fragment across pages without highlighting the gap", () => {
  const map: CharMap = [
    ...charMap,
    { charStart: 10, charEnd: 20, page: 1, itemIndex: 1, itemCharStart: 0, itemCharEnd: 10 },
    { charStart: 20, charEnd: 30, page: 2, itemIndex: 0, itemCharStart: 0, itemCharEnd: 10 },
  ];
  const pages = new Map([
    [1, new Map([[0, { x: 0, y: 700, width: 100, height: 12 }], [1, { x: 0, y: 680, width: 100, height: 12 }]])],
    [2, new Map([[0, { x: 0, y: 700, width: 100, height: 12 }]])],
  ]);
  const note = { ...agent, anchor: { ...anchor, charRange: { start: 0, end: 30 }, charRanges: [{ start: 0, end: 10 }, { start: 20, end: 30 }] } };
  const highlights = annotationsToHighlights([note], map, pages);
  expect(highlights).toHaveLength(2);
  expect(highlights.map(highlight => highlight.position.rects.length)).toEqual([1, 1]);
});
