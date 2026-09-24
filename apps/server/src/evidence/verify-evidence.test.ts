import { describe, expect, it } from "vitest";
import type { Node as IrNode } from "@paper-xray/contracts";
import { verifyEvidence } from "./verify-evidence.js";

const TEXT = "The method section describes our approach in detail.";

function paragraphNode(overrides: Partial<IrNode> = {}): IrNode {
  return {
    id: "node-1",
    type: "paragraph",
    parentId: null,
    order: 0,
    charRange: { start: 0, end: TEXT.length },
    pageHint: 1,
    ...overrides,
  };
}

describe("verifyEvidence", () => {
  it("passes a span that exists in the text and scope 'all'", () => {
    const result = verifyEvidence({
      normalizedText: TEXT,
      evidenceSpan: { start: 4, end: 10 },
      scope: "all",
      nodes: [],
    });
    expect(result.existsInText).toBe(true);
    expect(result.withinScope).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("fails when the span runs past the end of normalizedText", () => {
    const result = verifyEvidence({
      normalizedText: TEXT,
      evidenceSpan: { start: 0, end: TEXT.length + 50 },
      scope: "all",
      nodes: [],
    });
    expect(result.existsInText).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails on a negative start", () => {
    const result = verifyEvidence({
      normalizedText: TEXT,
      evidenceSpan: { start: -5, end: 10 },
      scope: "all",
      nodes: [],
    });
    expect(result.existsInText).toBe(false);
  });

  it("fails on an empty or inverted range", () => {
    expect(
      verifyEvidence({ normalizedText: TEXT, evidenceSpan: { start: 10, end: 10 }, scope: "all", nodes: [] })
        .existsInText,
    ).toBe(false);
    expect(
      verifyEvidence({ normalizedText: TEXT, evidenceSpan: { start: 10, end: 5 }, scope: "all", nodes: [] })
        .existsInText,
    ).toBe(false);
  });

  it("passes when the span falls fully inside a node of the declared scope type", () => {
    const node = paragraphNode({ type: "equation", charRange: { start: 0, end: TEXT.length } });
    const result = verifyEvidence({
      normalizedText: TEXT,
      evidenceSpan: { start: 4, end: 10 },
      scope: "equation",
      nodes: [node],
    });
    expect(result.withinScope).toBe(true);
  });

  it("fails scope when no node of the declared type covers the span", () => {
    const node = paragraphNode({ type: "table", charRange: { start: 0, end: TEXT.length } });
    const result = verifyEvidence({
      normalizedText: TEXT,
      evidenceSpan: { start: 4, end: 10 },
      scope: "equation",
      nodes: [node],
    });
    expect(result.withinScope).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails scope when the span only partially overlaps a matching-type node", () => {
    const node = paragraphNode({
      type: "equation",
      charRange: { start: 0, end: 8 }, // span below extends past this node's end
    });
    const result = verifyEvidence({
      normalizedText: TEXT,
      evidenceSpan: { start: 4, end: 10 },
      scope: "equation",
      nodes: [node],
    });
    expect(result.withinScope).toBe(false);
  });

  it("never reports semanticMatch as a pass — it isn't checked", () => {
    const result = verifyEvidence({
      normalizedText: TEXT,
      evidenceSpan: { start: 0, end: 5 },
      scope: "all",
      nodes: [],
    });
    expect(result.semanticMatch).toBeNull();
  });
});
