import { v4 as uuid } from "uuid";
import type { AgentAnnotation, CharRange, LensSpec, Node as IrNode, Severity } from "@paper-xray/contracts";
import { codePointLength } from "@paper-xray/contracts";
import { callChatModel } from "./model-client.js";

// Keeps prompt size (cost + latency) bounded. Not a chunking strategy — long
// papers get truncated to their first ~100k chars (most papers are shorter
// than this end-to-end) — acceptable for now since accuracy tuning against a
// golden set is explicitly out of scope.
const MAX_INPUT_CHARS = 100_000;

const VALID_SEVERITIES: readonly Severity[] = ["info", "low", "medium", "high"];

interface ModelAnnotationItem {
  evidenceText?: unknown;
  comment?: unknown;
  severity?: unknown;
  confidence?: unknown;
}

/**
 * `evidenceText` comes back as a plain string from the model; the rest of
 * this codebase (evidence verification, CharMap, anchoring) works in
 * code-point offsets into normalizedText (docs/02-decisions.md #12), never
 * UTF-16 units. `String.indexOf` is UTF-16-indexed, so the match position is
 * converted via codePointLength of everything before it, rather than used
 * directly.
 */
function findEvidenceRange(normalizedText: string, evidenceText: string): CharRange | null {
  const utf16Start = normalizedText.indexOf(evidenceText);
  if (utf16Start === -1) return null;
  const start = codePointLength(normalizedText.slice(0, utf16Start));
  const end = start + codePointLength(evidenceText);
  return { start, end };
}

function findContainingNode(nodes: IrNode[], charStart: number): IrNode | null {
  return nodes.find((n) => charStart >= n.charRange.start && charStart < n.charRange.end) ?? null;
}

function buildSystemPrompt(spec: LensSpec): string {
  return `You are "${spec.name}", an automated peer-review lens for academic papers. ${spec.description}

Task: ${spec.instruction}

Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:
{"annotations": [{"evidenceText": string, "comment": string, "severity": "info"|"low"|"medium"|"high", "confidence": number}]}

Rules:
- evidenceText MUST be an exact, verbatim substring copied character-for-character from the paper text given in the next message — it is used to programmatically locate the span in the source; paraphrasing, truncating, or fixing typos in it will cause the annotation to be silently discarded.
- confidence is your own 0.0-1.0 estimate that this is a genuine, worthwhile issue.
- Produce at most ${spec.maxAnnotations} annotations. Return fewer, or an empty array, if you don't find that many genuine issues — do not pad with weak or repetitive observations.
- Each comment: 1-2 sentences, self-contained, in English.`;
}

function parseModelJson(raw: string): { annotations?: unknown } | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(stripped) as { annotations?: unknown };
  } catch {
    return null;
  }
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Runs one LensSpec against the org-configured model (docs/02-decisions.md
 * #6: org lenses run server-side). Returns *candidate* AgentAnnotations —
 * evidenceSpan/anchor are computed here from the model's quoted text, but
 * this is still a pre-check only; the caller must still run these through
 * ../evidence/apply-verification.ts before persisting, same as any other
 * lens (never trust a lens's own evidence claim, model-backed or not).
 */
export async function runModelLens(params: {
  spec: LensSpec;
  docId: string;
  normalizedText: string;
  nodes: IrNode[];
}): Promise<AgentAnnotation[]> {
  const { spec, docId, normalizedText, nodes } = params;
  if (normalizedText.trim().length === 0) return [];

  const runId = uuid();
  const text = normalizedText.length > MAX_INPUT_CHARS ? normalizedText.slice(0, MAX_INPUT_CHARS) : normalizedText;

  const raw = await callChatModel([
    { role: "system", content: buildSystemPrompt(spec) },
    { role: "user", content: text },
  ]);

  const parsed = parseModelJson(raw);
  const items = Array.isArray(parsed?.annotations) ? (parsed!.annotations as ModelAnnotationItem[]) : [];

  const results: AgentAnnotation[] = [];
  for (const item of items.slice(0, spec.maxAnnotations)) {
    if (typeof item.evidenceText !== "string" || typeof item.comment !== "string") continue;

    const range = findEvidenceRange(normalizedText, item.evidenceText);
    if (!range) continue; // not a verbatim quote — evidence verification would drop it anyway

    const node = findContainingNode(nodes, range.start);
    if (!node) continue; // evidence falls in a paragraph separator, not any real node — can't anchor it

    const severity = VALID_SEVERITIES.includes(item.severity as Severity) ? (item.severity as Severity) : "info";

    results.push({
      id: uuid(),
      docId,
      agentId: spec.id,
      agentVersion: spec.version,
      runId,
      anchor: { charRange: range, contextPrefix: "", contextSuffix: "", nodeId: node.id },
      evidenceSpan: range,
      comment: item.comment,
      severity,
      confidence: clampConfidence(item.confidence),
      visibility: "org",
      createdAt: new Date().toISOString(),
    });
  }

  return results;
}
