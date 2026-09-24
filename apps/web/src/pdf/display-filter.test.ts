import { describe, expect, it } from "vitest";
import type { AgentAnnotation, HumanAnnotation, Severity } from "@paper-xray/contracts";
import { applyDisplayFilter, DEFAULT_DISPLAY_SETTINGS, pageDensity } from "./display-filter";

const anchor = { charRange: { start: 0, end: 1 }, contextPrefix: "", contextSuffix: "", nodeId: "n" };

function agent(id: string, agentId: string, confidence: number, severity: Severity = "medium"): AgentAnnotation {
  return {
    id,
    docId: "d",
    agentId,
    agentVersion: "1",
    runId: "r",
    ownerId: null,
    anchor,
    evidenceSpan: anchor.charRange,
    comment: id,
    severity,
    confidence,
    visibility: "org",
    createdAt: "",
  };
}

function human(id: string): HumanAnnotation {
  return {
    id,
    docId: "d",
    authorId: "u",
    anchor,
    body: id,
    visibility: "org",
    version: 1,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

describe("applyDisplayFilter", () => {
  it("hides low-confidence agent annotations but never human ones", () => {
    const result = applyDisplayFilter([agent("a", "L", 0.2), agent("b", "L", 0.9), human("h")], DEFAULT_DISPLAY_SETTINGS);
    expect(result.visible.map((a) => a.id)).toEqual(["b", "h"]);
    expect(result.hiddenByConfidence).toBe(1);
  });

  it("caps each lens separately, keeping the most severe then most confident, in original order", () => {
    const list = [
      agent("l1", "L", 0.6, "low"),
      agent("l2", "L", 0.7, "high"),
      agent("l3", "L", 0.9, "medium"),
      agent("l4", "L", 0.8, "high"),
      agent("m1", "M", 0.6),
    ];
    const result = applyDisplayFilter(list, { minConfidence: 0, perLensCap: 2, hiddenGroups: [] });
    expect(result.visible.map((a) => a.id)).toEqual(["l2", "l4", "m1"]);
    expect(result.hiddenByCap).toBe(2);
  });

  it("switches whole groups off, including human notes", () => {
    const result = applyDisplayFilter([agent("a", "L", 0.9), agent("b", "M", 0.9), human("h")], {
      ...DEFAULT_DISPLAY_SETTINGS,
      hiddenGroups: ["L", "human"],
    });
    expect(result.visible.map((a) => a.id)).toEqual(["b"]);
    expect(result.hiddenByGroup).toBe(2);
  });
});

describe("pageDensity", () => {
  const at = (annotationId: string, page: number, isAgent = true) => ({
    annotationId,
    isAgent,
    position: { boundingRect: { pageNumber: page } },
  });

  it("counts each annotation once per page it touches", () => {
    const density = pageDensity([at("a", 1), at("a", 1), at("a", 2), at("h", 2, false), at("x", 9)], 3);
    expect(density).toEqual([
      { page: 1, agent: 1, human: 0 },
      { page: 2, agent: 1, human: 1 },
      { page: 3, agent: 0, human: 0 },
    ]);
  });
});
