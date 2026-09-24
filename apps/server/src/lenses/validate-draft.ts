import type { LensDraft, LensScope } from "@paper-xray/contracts";
import { LENS_SCOPES, MAX_ANNOTATIONS_LIMIT } from "@paper-xray/contracts";

/** Validates a lens definition from a request body. Returns the cleaned draft, or a message saying what's wrong. */
export function validateLensDraft(body: unknown): { ok: true; draft: LensDraft } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Expected a JSON object" };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length === 0 || name.length > 120) return { ok: false, error: "name is required (1-120 characters)" };

  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (description.length > 500) return { ok: false, error: "description must be at most 500 characters" };

  const instruction = typeof b.instruction === "string" ? b.instruction.trim() : "";
  if (instruction.length < 10 || instruction.length > 4000) {
    return { ok: false, error: "instruction is required (10-4000 characters)" };
  }

  if (!LENS_SCOPES.includes(b.scope as LensScope)) {
    return { ok: false, error: `scope must be one of: ${LENS_SCOPES.join(", ")}` };
  }

  const maxAnnotations = b.maxAnnotations;
  if (
    typeof maxAnnotations !== "number" ||
    !Number.isInteger(maxAnnotations) ||
    maxAnnotations < 1 ||
    maxAnnotations > MAX_ANNOTATIONS_LIMIT
  ) {
    return { ok: false, error: `maxAnnotations must be an integer from 1 to ${MAX_ANNOTATIONS_LIMIT}` };
  }

  return {
    ok: true,
    draft: {
      name,
      description,
      instruction,
      scope: b.scope as LensScope,
      maxAnnotations,
      strictScope: b.strictScope === true,
      shareRunsWithOrg: b.shareRunsWithOrg === true,
    },
  };
}
