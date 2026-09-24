import { describe, expect, it, vi } from "vitest";
import type { LensSpec, Node as IrNode } from "@paper-xray/contracts";
import { callChatModel } from "./model-client.js";
import { runModelLens } from "./run-model-lens.js";

vi.mock("./model-client.js", () => ({ callChatModel: vi.fn() }));

const TEXT = "We use a novel transformer architecture for this task. It works well in practice.";

const SPEC: LensSpec = {
  id: "test-lens",
  name: "Test Lens",
  description: "test",
  version: "1.0.0",
  kind: "model",
  scope: "all",
  instruction: "test",
  outputSchema: { requiresEvidenceSpan: true, requiresComment: true, requiresSeverity: true },
  maxAnnotations: 3,
  executionContext: "org-server",
};

const NODE: IrNode = {
  id: "n1",
  type: "paragraph",
  parentId: null,
  order: 0,
  charRange: { start: 0, end: TEXT.length },
  pageHint: 1,
};

describe("runModelLens", () => {
  it("converts a valid model response into an anchored, evidence-backed AgentAnnotation", async () => {
    vi.mocked(callChatModel).mockResolvedValue(
      JSON.stringify({
        annotations: [
          {
            evidenceText: "We use a novel transformer architecture for this task.",
            comment: "Novelty claim is not compared against prior transformer variants.",
            severity: "medium",
            confidence: 0.8,
          },
        ],
      }),
    );

    const result = await runModelLens({ spec: SPEC, docId: "doc1", normalizedText: TEXT, nodes: [NODE] });

    expect(result).toHaveLength(1);
    expect(result[0].evidenceSpan).toEqual({ start: 0, end: "We use a novel transformer architecture for this task.".length });
    expect(result[0].anchor.nodeId).toBe("n1");
    expect(result[0].severity).toBe("medium");
    expect(result[0].confidence).toBe(0.8);
    expect(result[0].agentId).toBe("test-lens");
  });

  it("drops an item whose evidenceText isn't a verbatim substring", async () => {
    vi.mocked(callChatModel).mockResolvedValue(
      JSON.stringify({ annotations: [{ evidenceText: "text that does not appear", comment: "x", severity: "low" }] }),
    );

    const result = await runModelLens({ spec: SPEC, docId: "doc1", normalizedText: TEXT, nodes: [NODE] });
    expect(result).toHaveLength(0);
  });

  it("tolerates a response wrapped in a markdown code fence", async () => {
    vi.mocked(callChatModel).mockResolvedValue(
      "```json\n" + JSON.stringify({ annotations: [{ evidenceText: "It works well in practice.", comment: "x", severity: "info" }] }) + "\n```",
    );

    const result = await runModelLens({ spec: SPEC, docId: "doc1", normalizedText: TEXT, nodes: [NODE] });
    expect(result).toHaveLength(1);
  });

  it("returns an empty array on unparseable model output instead of throwing", async () => {
    vi.mocked(callChatModel).mockResolvedValue("not json at all");
    const result = await runModelLens({ spec: SPEC, docId: "doc1", normalizedText: TEXT, nodes: [NODE] });
    expect(result).toEqual([]);
  });

  it("clamps an out-of-range confidence into [0, 1]", async () => {
    vi.mocked(callChatModel).mockResolvedValue(
      JSON.stringify({ annotations: [{ evidenceText: "It works well in practice.", comment: "x", severity: "info", confidence: 5 }] }),
    );
    const result = await runModelLens({ spec: SPEC, docId: "doc1", normalizedText: TEXT, nodes: [NODE] });
    expect(result[0].confidence).toBe(1);
  });

  it("caps output at spec.maxAnnotations even if the model returns more", async () => {
    const many = Array.from({ length: 10 }, () => ({
      evidenceText: "It works well in practice.",
      comment: "x",
      severity: "info",
    }));
    vi.mocked(callChatModel).mockResolvedValue(JSON.stringify({ annotations: many }));
    const result = await runModelLens({ spec: SPEC, docId: "doc1", normalizedText: TEXT, nodes: [NODE] });
    expect(result.length).toBeLessThanOrEqual(SPEC.maxAnnotations);
  });
});
