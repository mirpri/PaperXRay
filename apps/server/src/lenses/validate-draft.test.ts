import { describe, expect, it } from "vitest";
import { LENS_COLORS, lensColor } from "@paper-xray/contracts";
import { validateLensDraft } from "./validate-draft.js";

const VALID = {
  name: "  Power check ",
  description: "Flags underpowered stats",
  instruction: "Find statistical tests reported without sample size.",
  scope: "table",
  maxAnnotations: 5,
};

describe("validateLensDraft", () => {
  it("accepts and trims a valid draft, defaulting the booleans to false", () => {
    const result = validateLensDraft(VALID);
    expect(result).toEqual({
      ok: true,
      draft: { ...VALID, name: "Power check", strictScope: false, shareRunsWithOrg: false },
    });
  });

  it.each([
    [{ ...VALID, name: "" }, /name/],
    [{ ...VALID, instruction: "short" }, /instruction/],
    [{ ...VALID, scope: "method" }, /scope/],
    [{ ...VALID, maxAnnotations: 0 }, /maxAnnotations/],
    [{ ...VALID, maxAnnotations: 2.5 }, /maxAnnotations/],
    [{ ...VALID, maxAnnotations: 999 }, /maxAnnotations/],
    [null, /object/],
  ])("rejects %j", (body, message) => {
    const result = validateLensDraft(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});

describe("Lens colors", () => {
  it("offers exactly 12 distinct preset colors and accepts each one", () => {
    expect(LENS_COLORS).toHaveLength(12); expect(new Set(LENS_COLORS.map(c => c.value)).size).toBe(12);
    for (const c of LENS_COLORS) {
      expect(validateLensDraft({ ...VALID, color: c.value.toLowerCase() })).toMatchObject({ ok: true, draft: { color: c.value } });
    }
  });
  it.each(["red", "#123456", "#fff", "url(test)", null, 123])("rejects arbitrary color %j", color => {
    expect(validateLensDraft({ ...VALID, color })).toMatchObject({ ok: false, error: expect.stringContaining("color") });
  });
  it("keeps old clients compatible and uses stable fallback colors", () => {
    const result = validateLensDraft(VALID); expect(result.ok && result.draft.color).toBeUndefined();
    expect(lensColor("old-lens")).toBe(lensColor("old-lens"));
    expect(LENS_COLORS.some(c => c.value === lensColor("deleted-lens"))).toBe(true);
    expect(lensColor("lens", "#168575")).toBe("#168575");
    expect(new Set(["preset-methodology-review", "preset-experiment-stats", "preset-reproducibility", "preset-novelty"].map(id => lensColor(id))).size).toBe(4);
  });
});
