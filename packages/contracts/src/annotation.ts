/**
 * Annotation contracts — two data models with deliberately different
 * lifecycles. See docs/01-nabcd-architecture.md "核心数据模型" +
 * "agent 层与人类层分离", and docs/02-decisions.md #5 (visibility) and
 * #6 (server-side evidence re-verification is mandatory, never trust the
 * client).
 */

import type { CharRange } from "./ir.js";

/** Visibility of an annotation or an agent run (docs/02-decisions.md #5). Sharing granularity is the run, not the individual annotation. */
export type Visibility = "private" | "org";

export type Severity = "info" | "low" | "medium" | "high";

export interface Anchor {
  charRange: CharRange;
  /** A few characters of normalizedText immediately before charRange.start, captured at creation time so the anchor can be sanity-checked (or re-fuzzy-matched) if the parser version changes. */
  contextPrefix: string;
  /** Same, immediately after charRange.end. */
  contextSuffix: string;
  /** IR Node this anchor falls within, for scope checks and grouping. */
  nodeId: string;
}

export interface HumanAnnotation {
  id: string;
  docId: string;
  authorId: string;
  anchor: Anchor;
  /** Rich text (author-controlled). */
  body: string;
  visibility: Visibility;
  /** Optimistic-lock counter. Every update must supply the version it read; server rejects on mismatch (docs/01 "实时协作", docs/02-decisions.md #12). */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Soft delete — human annotations are append-only threads, never hard-deleted, so replies retain context. */
  deletedAt: string | null;
}

export interface AgentAnnotation {
  id: string;
  docId: string;
  agentId: string;
  agentVersion: string;
  /** Groups all annotations produced by one execution of one agent version. Rerunning an agent produces a new runId, never mutates a previous run (docs/01 "重跑与版本管理"). */
  runId: string;
  /** User who produced this run with a personal lens; null for org-lens runs. A `private` run is visible only to its owner (docs/02-decisions.md #5). */
  ownerId: string | null;
  anchor: Anchor;
  /**
   * The exact source-text span the agent claims supports `comment`.
   * Required on every AgentAnnotation. The server independently re-verifies
   * that this span exists in normalizedText, is semantically consistent
   * with `comment`, and falls within the producing agent's declared scope
   * — client-side validation is a fast pre-check only and is never trusted
   * (docs/02-decisions.md #6).
   */
  evidenceSpan: CharRange;
  comment: string;
  severity: Severity;
  /** 0..1, model-reported or derived from evidence-check results. */
  confidence: number;
  visibility: Visibility;
  /** No updatedAt/deletedAt by design: agent annotations are immutable once produced (docs/01 "agent 层与人类层分离"). */
  createdAt: string;
}

export type Annotation = HumanAnnotation | AgentAnnotation;

export function isAgentAnnotation(a: Annotation): a is AgentAnnotation {
  return "agentId" in a;
}

export function isHumanAnnotation(a: Annotation): a is HumanAnnotation {
  return "authorId" in a;
}
