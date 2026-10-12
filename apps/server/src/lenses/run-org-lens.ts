import type { AgentAnnotation, LensSpec, Node as IrNode } from "@paper-xray/contracts";
import { runModelLens } from "./run-model-lens.js";
import { findLensModelConfig } from "../db/lens-model-config.js";

/** Runs a lens using its selected organization provider; ownership controls result visibility. */
export async function runOrgLens(params: {
  spec: LensSpec;
  docId: string;
  normalizedText: string;
  nodes: IrNode[];
  signal?: AbortSignal;
}): Promise<AgentAnnotation[]> {
  const { spec, docId, normalizedText, nodes } = params;
  if (spec.executionContext !== "org-server") {
    throw new Error("Lenses using personal providers run in the browser, not on the server");
  }
  const modelConfig = await findLensModelConfig(spec.id);
  if (!modelConfig) {
    throw new Error("This organization lens has no model API configured. Ask an administrator to configure it in the admin panel.");
  }
  return runModelLens({ spec, docId, normalizedText, nodes, modelConfig,
    ...(params.signal ? { signal: params.signal } : {}) });
}
