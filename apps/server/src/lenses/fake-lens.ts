import { v4 as uuid } from "uuid";
import type { AgentAnnotation } from "@paper-xray/contracts";
import { codePointLength, sliceByCodePoints } from "@paper-xray/contracts";

/**
 * A lens with a hard-coded rule instead of a model call, standing in for a
 * real LensSpec-driven agent. Its only job is to unblock the W1 vertical
 * slice (docs/02-decisions.md #10): produce annotations whose evidenceSpan
 * is trivially verifiable (a literal substring of normalizedText) so the
 * evidence-check step later has something real to validate against, and so
 * the sidebar list has something to render before the real agent runtime
 * (W4) exists.
 */
export function runFakeLens(params: {
  docId: string;
  normalizedText: string;
  /** Node the evidenceSpan's anchor is attributed to — typically the document's first paragraph node. */
  anchorNodeId: string;
  /** The lens this stands in for, so the result is attributed to (and counted under) the lens the user actually ran. */
  lens?: { id: string; version: string };
}): AgentAnnotation[] {
  const { docId, normalizedText, anchorNodeId, lens } = params;
  const runId = uuid();
  const totalLength = codePointLength(normalizedText);

  if (totalLength === 0) {
    return [];
  }

  const evidenceEnd = Math.min(40, totalLength);
  const evidenceSpan = { start: 0, end: evidenceEnd };
  const evidenceText = sliceByCodePoints(normalizedText, 0, evidenceEnd);

  const annotation: AgentAnnotation = {
    id: uuid(),
    docId,
    agentId: lens?.id ?? "fake-lens",
    agentVersion: lens?.version ?? "0.0.1",
    runId,
    ownerId: null,
    anchor: {
      charRange: evidenceSpan,
      contextPrefix: "",
      contextSuffix: sliceByCodePoints(
        normalizedText,
        evidenceEnd,
        Math.min(evidenceEnd + 20, totalLength),
      ),
      nodeId: anchorNodeId,
    },
    evidenceSpan,
    comment: `Fake lens: this document opens with "${evidenceText.trim()}"`,
    severity: "info",
    confidence: 1,
    visibility: "org",
    createdAt: new Date().toISOString(),
  };

  return [annotation];
}
