/**
 * The model-facing half of a lens run, shared by the server (org lenses)
 * and the browser (personal lenses, docs/02-decisions.md #6) so both build
 * the same prompt and parse the same output shape. Deliberately free of
 * any network code: callers bring their own model client.
 *
 * The model never produces offsets. It quotes `evidenceText` verbatim and
 * whoever persists the result locates that quote in normalizedText itself
 * — for personal lenses that's the server, which never accepts a
 * client-computed span.
 */
import type { CharRange } from "./ir.js";
import type { Severity } from "./annotation.js";
import type { LensSpec } from "./lens.js";
import { codePointLength } from "./codepoints.js";

/** One annotation as the model returns it, after shape-checking. */
export interface LensOutputItem {
  evidenceText: string;
  comment: string;
  severity: Severity;
  confidence: number;
}

// Keeps prompt size (cost + latency) bounded. Long papers get truncated to
// their first ~100k chars; most papers are shorter than this end-to-end.
export const MAX_LENS_INPUT_CHARS = 100_000;

const VALID_SEVERITIES: readonly Severity[] = ["info", "low", "medium", "high"];

export function buildLensSystemPrompt(spec: Pick<LensSpec, "name" | "description" | "instruction" | "maxAnnotations">): string {
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

/** The user message for a lens run: the document text, truncated to MAX_LENS_INPUT_CHARS. */
export function buildLensUserMessage(normalizedText: string): string {
  return normalizedText.length > MAX_LENS_INPUT_CHARS ? normalizedText.slice(0, MAX_LENS_INPUT_CHARS) : normalizedText;
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** Shape-checks arbitrary items (from a model, or from a client POST) into LensOutputItems, dropping anything malformed and capping at `max`. */
export function sanitizeLensItems(items: unknown, max: number): LensOutputItem[] {
  if (!Array.isArray(items)) return [];
  const out: LensOutputItem[] = [];
  for (const raw of items) {
    if (out.length >= max) break;
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.evidenceText !== "string" || item.evidenceText.length === 0) continue;
    if (typeof item.comment !== "string" || item.comment.trim().length === 0) continue;
    out.push({
      evidenceText: item.evidenceText,
      comment: item.comment,
      severity: VALID_SEVERITIES.includes(item.severity as Severity) ? (item.severity as Severity) : "info",
      confidence: clampConfidence(item.confidence),
    });
  }
  return out;
}

/** Parses a model's raw reply (tolerating ```json fences) into LensOutputItems. Unparseable output yields []. */
export function parseLensModelOutput(raw: string, max: number): LensOutputItem[] {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(stripped) as { annotations?: unknown };
    return sanitizeLensItems(parsed?.annotations, max);
  } catch {
    return [];
  }
}

/**
 * Locates a verbatim quote in normalizedText, as a code-point CharRange
 * (docs/02-decisions.md #12). `String.indexOf` is UTF-16-indexed, so the
 * match position is converted via codePointLength of everything before it.
 */
export function findEvidenceRange(normalizedText: string, evidenceText: string): CharRange | null {
  if (evidenceText.length === 0) return null;
  const utf16Start = normalizedText.indexOf(evidenceText);
  if (utf16Start === -1) return null;
  const start = codePointLength(normalizedText.slice(0, utf16Start));
  return { start, end: start + codePointLength(evidenceText) };
}
