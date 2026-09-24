import type { AgentAnnotation, Node as IrNode } from "@paper-xray/contracts";
import { PRESET_LENSES } from "./presets.js";
import { runModelLens } from "./run-model-lens.js";
import { runFakeLens } from "./fake-lens.js";
import { isModelConfigured } from "./model-client.js";

/**
 * Runs every preset lens against a freshly-uploaded document. Falls back to
 * the deterministic fake-lens when no model endpoint is configured (dev/CI
 * without a PPIO key) rather than failing the upload outright. Each lens
 * runs independently (Promise.allSettled) so one lens erroring — a bad model
 * response, a rate limit — doesn't take the others down with it.
 */
export async function runAllLenses(params: {
  docId: string;
  normalizedText: string;
  nodes: IrNode[];
}): Promise<AgentAnnotation[]> {
  const { docId, normalizedText, nodes } = params;

  if (!isModelConfigured()) {
    if (nodes.length === 0) return [];
    return runFakeLens({ docId, normalizedText, anchorNodeId: nodes[0].id });
  }

  const settled = await Promise.allSettled(
    PRESET_LENSES.map((spec) => runModelLens({ spec, docId, normalizedText, nodes })),
  );

  const annotations: AgentAnnotation[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      annotations.push(...result.value);
    } else {
      console.error("Lens run failed:", result.reason);
    }
  }
  return annotations;
}

/**
 * Runs a single named preset lens on demand — the "click a dashed lens chip
 * to run it" flow, as opposed to runAllLenses's every-lens-at-once. Throws
 * if lensId doesn't match a known preset; the route handler is expected to
 * turn that into a 400, not a 500.
 */
export async function runLensById(params: {
  lensId: string;
  docId: string;
  normalizedText: string;
  nodes: IrNode[];
}): Promise<AgentAnnotation[]> {
  const { lensId, docId, normalizedText, nodes } = params;
  const spec = PRESET_LENSES.find((s) => s.id === lensId);
  if (!spec) {
    throw new Error(`Unknown lens id: ${lensId}`);
  }

  if (!isModelConfigured()) {
    if (nodes.length === 0) return [];
    return runFakeLens({ docId, normalizedText, anchorNodeId: nodes[0].id });
  }

  return runModelLens({ spec, docId, normalizedText, nodes });
}
