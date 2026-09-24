import type { AgentAnnotation, LensScope, Node as IrNode } from "@paper-xray/contracts";
import { verifyEvidence } from "./verify-evidence.js";

/**
 * Applies server-side evidence verification to a lens run's candidate
 * output before it's persisted (docs/01-nabcd-architecture.md "证据校验":
 * "不达标则降级为低置信度或直接丢弃"). A span that doesn't exist in the
 * document at all is dropped outright — there's nothing sound to anchor or
 * show. A span that exists but falls outside the lens's declared scope is
 * kept but downgraded to low confidence/info severity, since the content
 * may still be useful even though the lens didn't respect its own scope
 * contract; dropping it silently would hide that the lens is misbehaving.
 */
export function verifyAndFilterAgentAnnotations(params: {
  candidates: AgentAnnotation[];
  normalizedText: string;
  nodes: IrNode[];
  scope: LensScope;
  /** The lens asked for out-of-scope evidence to be dropped rather than downgraded (LensSpec.strictScope). */
  strictScope?: boolean;
}): AgentAnnotation[] {
  const { candidates, normalizedText, nodes, scope, strictScope = false } = params;
  const kept: AgentAnnotation[] = [];

  for (const candidate of candidates) {
    const result = verifyEvidence({
      normalizedText,
      evidenceSpan: candidate.evidenceSpan,
      scope,
      nodes,
    });

    if (!result.existsInText) continue;

    if (!result.withinScope) {
      if (strictScope) continue;
      kept.push({ ...candidate, severity: "info", confidence: Math.min(candidate.confidence, 0.2) });
      continue;
    }

    kept.push(candidate);
  }

  return kept;
}
