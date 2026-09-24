import { describe, expect, it } from "vitest";
import type { AgentAnnotation, Node as IrNode } from "@paper-xray/contracts";
import { verifyAndFilterAgentAnnotations } from "./apply-verification.js";

const TEXT = "The method section describes our approach in detail.";

function annotation(overrides: Partial<AgentAnnotation> = {}): AgentAnnotation {
  return {
    id: "a1",
    docId: "doc1",
    agentId: "test-lens",
    agentVersion: "1.0.0",
    runId: "run1",
    ownerId: null,
    anchor: { charRange: { start: 0, end: 10 }, contextPrefix: "", contextSuffix: "", nodeId: "n1" },
    evidenceSpan: { start: 0, end: 10 },
    comment: "test comment",
    severity: "high",
    confidence: 0.9,
    visibility: "org",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("verifyAndFilterAgentAnnotations", () => {
  it("keeps an annotation whose evidence exists and is in scope, unchanged", () => {
    const result = verifyAndFilterAgentAnnotations({
      candidates: [annotation()],
      normalizedText: TEXT,
      nodes: [],
      scope: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("high");
    expect(result[0].confidence).toBe(0.9);
  });

  it("drops an annotation whose evidenceSpan doesn't exist in the text", () => {
    const result = verifyAndFilterAgentAnnotations({
      candidates: [annotation({ evidenceSpan: { start: 0, end: 999 } })],
      normalizedText: TEXT,
      nodes: [],
      scope: "all",
    });
    expect(result).toHaveLength(0);
  });

  it("downgrades (never drops) an annotation whose evidence exists but is outside the declared scope", () => {
    const node: IrNode = {
      id: "n1",
      type: "table",
      parentId: null,
      order: 0,
      charRange: { start: 20, end: 40 },
      pageHint: 1,
    };
    const result = verifyAndFilterAgentAnnotations({
      candidates: [annotation({ evidenceSpan: { start: 0, end: 10 }, severity: "high", confidence: 0.9 })],
      normalizedText: TEXT,
      nodes: [node],
      scope: "equation",
    });
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("info");
    expect(result[0].confidence).toBeLessThanOrEqual(0.2);
  });

  it("processes a batch independently — one bad annotation doesn't affect the others", () => {
    const good = annotation({ id: "good" });
    const bad = annotation({ id: "bad", evidenceSpan: { start: -5, end: 10 } });
    const result = verifyAndFilterAgentAnnotations({
      candidates: [good, bad],
      normalizedText: TEXT,
      nodes: [],
      scope: "all",
    });
    expect(result.map((a) => a.id)).toEqual(["good"]);
  });
});

describe("verifyAndFilterAgentAnnotations with strictScope", () => {
  it("drops out-of-scope evidence instead of downgrading it", () => {
    const nodes: IrNode[] = [
      { id: "n1", type: "table", parentId: null, order: 0, charRange: { start: 20, end: 30 }, pageHint: 1 },
    ];
    const common = { candidates: [annotation()], normalizedText: TEXT, nodes, scope: "table" as const };
    expect(verifyAndFilterAgentAnnotations(common)).toHaveLength(1);
    expect(verifyAndFilterAgentAnnotations({ ...common, strictScope: true })).toHaveLength(0);
  });
});
