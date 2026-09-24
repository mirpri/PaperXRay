import { describe, expect, it } from "vitest";
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
