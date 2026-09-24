import type { AgentAnnotation, LensSpec, Node as IrNode } from "@paper-xray/contracts";
import { runModelLens } from "./run-model-lens.js";
import { runFakeLens } from "./fake-lens.js";
import { isModelConfigured } from "./model-client.js";

/**
 * Runs one org lens server-side (docs/02-decisions.md #6). Falls back to
 * the deterministic fake-lens when no org model endpoint is configured
 * (dev/CI without a PPIO key) instead of failing the request.
 */
export async function runOrgLens(params: {
  spec: LensSpec;
  docId: string;
  normalizedText: string;
  nodes: IrNode[];
}): Promise<AgentAnnotation[]> {
  const { spec, docId, normalizedText, nodes } = params;
  if (spec.executionContext !== "org-server") {
    throw new Error("Personal lenses run in the browser, not on the server");
  }
  if (!isModelConfigured()) {
    if (nodes.length === 0) return [];
    return runFakeLens({ docId, normalizedText, anchorNodeId: nodes[0].id, lens: spec });
  }
  return runModelLens({ spec, docId, normalizedText, nodes });
}
