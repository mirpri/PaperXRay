import { v4 as uuid } from "uuid";
import type { AgentAnnotation, LensOutputItem, LensSpec, Node as IrNode } from "@paper-xray/contracts";
import {
  buildLensSystemPrompt,
  buildLensUserMessage,
  codePointLength,
  findEvidenceRange,
  parseLensModelOutput,
  sliceByCodePoints,
} from "@paper-xray/contracts";
import { callChatModel } from "./model-client.js";

const CONTEXT_CHARS = 32;

function findContainingNode(nodes: IrNode[], charStart: number): IrNode | null {
  return nodes.find((n) => charStart >= n.charRange.start && charStart < n.charRange.end) ?? null;
}

/**
 * Turns quoted lens output into *candidate* AgentAnnotations: each quote is
 * located in normalizedText here, by the server — never taken from whoever
 * produced it — and quotes that aren't verbatim are dropped. Used for both
 * org lenses (output from the server's own model call) and personal lenses
 * (output POSTed by the browser, docs/02-decisions.md #6). Callers must
 * still run the result through ../evidence/apply-verification.ts.
 */
export function lensItemsToCandidates(params: {
  items: LensOutputItem[];
  spec: LensSpec;
  docId: string;
  normalizedText: string;
  nodes: IrNode[];
  ownerId: string | null;
}): AgentAnnotation[] {
  const { items, spec, docId, normalizedText, nodes, ownerId } = params;
  const runId = uuid();
  const total = codePointLength(normalizedText);
  const visibility = ownerId !== null && !spec.shareRunsWithOrg ? "private" : "org";

  const results: AgentAnnotation[] = [];
  for (const item of items.slice(0, spec.maxAnnotations)) {
    const range = findEvidenceRange(normalizedText, item.evidenceText);
    if (!range) continue; // not a verbatim quote

    const node = findContainingNode(nodes, range.start);
    if (!node) continue; // evidence falls in a paragraph separator, not any real node — can't anchor it

    results.push({
      id: uuid(),
      docId,
      agentId: spec.id,
      agentVersion: spec.version,
      runId,
      ownerId,
      anchor: {
        charRange: range,
        contextPrefix: sliceByCodePoints(normalizedText, Math.max(0, range.start - CONTEXT_CHARS), range.start),
        contextSuffix: sliceByCodePoints(normalizedText, range.end, Math.min(total, range.end + CONTEXT_CHARS)),
        nodeId: node.id,
      },
      evidenceSpan: range,
      comment: item.comment,
      severity: item.severity,
      confidence: item.confidence,
      visibility,
      createdAt: new Date().toISOString(),
    });
  }
  return results;
}

/**
 * Runs one org LensSpec against the org-configured model
 * (docs/02-decisions.md #6: org lenses run server-side).
 */
export async function runModelLens(params: {
  spec: LensSpec;
  docId: string;
  normalizedText: string;
  nodes: IrNode[];
}): Promise<AgentAnnotation[]> {
  const { spec, docId, normalizedText, nodes } = params;
  if (normalizedText.trim().length === 0) return [];

  const raw = await callChatModel([
    { role: "system", content: buildLensSystemPrompt(spec) },
    { role: "user", content: buildLensUserMessage(normalizedText) },
  ]);

  const items = parseLensModelOutput(raw, spec.maxAnnotations);
  return lensItemsToCandidates({ items, spec, docId, normalizedText, nodes, ownerId: null });
}
