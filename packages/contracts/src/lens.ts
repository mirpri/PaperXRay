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
  providerId?: string | null;
  model?: string | null;
  /** Color from the shared 12-color palette. */
  color?: string;
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
   * Organization providers execute on the server; personal providers execute
   * in the owner's browser. A personal lens may select either type, while
   * organization lenses select only organization providers. Personal API
   * keys never reach the server. This field contains no credential.
   */
  executionContext: "org-server" | "personal-client";
  /** Owning user for a personal lens; null for org lenses (editable by curators). */
  ownerId: string | null;
  /**
   * When evidence falls outside `scope`: true drops the annotation, false
   * (default) keeps it downgraded to info / low confidence. Evidence that
   * doesn't exist in the text is always dropped regardless.
   */
  strictScope: boolean;
  /** Default visibility of a personal lens's runs: false = `private` (docs/02-decisions.md #5). Org lens runs are always `org`. */
  shareRunsWithOrg: boolean;
}

/** The user-editable part of a LensSpec — id, version, owner and execution context are assigned by the server. */
export interface LensDraft {
  providerId?: string | null;
  model?: string | null;
  /** Color from the shared 12-color palette. */
  color?: string;
  name: string;
  description: string;
  scope: LensScope;
  instruction: string;
  maxAnnotations: number;
  strictScope: boolean;
  shareRunsWithOrg: boolean;
}

export const LENS_SCOPES: readonly LensScope[] = ["all", "section", "paragraph", "equation", "figure", "table", "caption"];
export const MAX_ANNOTATIONS_LIMIT = 30;

/** Minimum default severities a lens output validator should accept. */
export const DEFAULT_SEVERITIES: readonly Severity[] = [
  "info",
  "low",
  "medium",
  "high",
];

/** Public provider metadata. Personal credentials remain in the owner's browser. */
export interface ModelProvider {
  id: string;
  ownerId: string | null;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
}
export interface ProviderDraft {
  name: string;
  baseUrl: string;
  models: string[];
  /** Only organizational providers accept a server-side key. */
  apiKey?: string | null;
}
