/**
 * LensSpec — the declarative contract a lens (= "agent" in code, "lens" in
 * UI copy per docs/02-decisions.md #1) is defined by. Users fill in this
 * declaration; they never get an open-ended prompt box. The runtime uses it
 * to decide which Nodes to feed the lens, how to schedule it, and how to
 * validate its output. See docs/01-nabcd-architecture.md "核心数据模型" +
 * "能力与运行时分离".
 */

import type { NodeType } from "./ir.js";
import type { Severity } from "./annotation.js";

export type LensScope = NodeType | "all";

/** What kind of runtime executes this lens. Deterministic parsing (e.g. term-definition lookup), a model call, or retrieval+model both satisfy the same LensSpec/output contract (docs/01 "能力与运行时分离"). */
export type LensKind = "deterministic" | "model" | "retrieval+model";

/** Shape every lens output item must satisfy; evidenceSpan/comment/severity are non-negotiable (docs/01 "核心数据模型"). */
export interface LensOutputSchema {
  requiresEvidenceSpan: true;
  requiresComment: true;
  requiresSeverity: true;
}

export interface LensSpec {
  id: string;
  name: string;
  description: string;
  version: string;
  kind: LensKind;
  /** Which Node types this lens consumes. */
  scope: LensScope;
  /** Natural-language (or, for deterministic lenses, structured) instruction describing what to look for. */
  instruction: string;
  outputSchema: LensOutputSchema;
  /** Hard cap on annotations produced per run, to bound screen-flooding (docs "防刷屏"). */
  maxAnnotations: number;
  /**
   * Org-owned lenses run server-side against an org-configured model
   * endpoint. Personal lenses run client-side against the user's own
   * endpoint/API key, which must never reach the server or database
   * (docs/02-decisions.md #6). This field only records which case applies;
   * it does not carry any credential.
   */
  executionContext: "org-server" | "personal-client";
}

/** Minimum default severities a lens output validator should accept. */
export const DEFAULT_SEVERITIES: readonly Severity[] = [
  "info",
  "low",
  "medium",
  "high",
];
