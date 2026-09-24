import type { CharRange, LensScope, Node as IrNode } from "@paper-xray/contracts";
import { codePointLength } from "@paper-xray/contracts";

/**
 * Server-side re-verification of an agent's evidenceSpan
 * (docs/01-nabcd-architecture.md "证据校验", docs/02-decisions.md #6:
 * "服务端不能信任客户端声称的校验结果" — this applies just as much to a
 * server-executed lens's own self-report as to a client-executed one).
 *
 * The architecture doc names three checks:
 *   1. the span exists in normalizedText
 *   2. the span's content is semantically consistent with the comment
 *   3. the span falls within the lens's declared scope
 *
 * Only (1) and (3) are implemented here — both are cheap, deterministic,
 * and fully checkable from data already on hand. (2) is a genuine judgment
 * call ("does this text actually support this claim?") that needs a model
 * call to do honestly; faking it with a string-similarity heuristic would
 * be worse than not having it, since it would look like real verification
 * in the golden-set harness this is meant to feed. `semanticMatch` is left
 * `null` (meaningfully "not checked"), not `true` — never read it as a
 * pass.
 */
export interface EvidenceVerification {
  existsInText: boolean;
  withinScope: boolean;
  semanticMatch: null;
  /** Whether this evidence clears every check this function actually performs. Does not account for semanticMatch. */
  passed: boolean;
}

export function verifyEvidence(params: {
  normalizedText: string;
  evidenceSpan: CharRange;
  scope: LensScope;
  /** The document's full Node tree, to look up which node(s) the span falls in for the scope check. */
  nodes: IrNode[];
}): EvidenceVerification {
  const { normalizedText, evidenceSpan, scope, nodes } = params;
  const totalLength = codePointLength(normalizedText);

  const existsInText =
    Number.isInteger(evidenceSpan.start) &&
    Number.isInteger(evidenceSpan.end) &&
    evidenceSpan.start >= 0 &&
    evidenceSpan.end <= totalLength &&
    evidenceSpan.start < evidenceSpan.end;

  const withinScope =
    existsInText &&
    (scope === "all" ||
      nodes.some(
        (n) => n.type === scope && evidenceSpan.start >= n.charRange.start && evidenceSpan.end <= n.charRange.end,
      ));

  return {
    existsInText,
    withinScope,
    semanticMatch: null,
    passed: existsInText && withinScope,
  };
}
