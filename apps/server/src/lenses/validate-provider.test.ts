import { describe, expect, it } from "vitest";
import { validateProvider } from "./validate-provider.js";
const valid = { name: " Test ", baseUrl: "https://example.com/v1/", models: ["one", " two ", "one"] };
describe("provider validation", () => {
  it("normalizes provider metadata and deduplicates selectable models", () => {
    expect(validateProvider(valid)).toEqual({ ok: true, draft: { name: "Test", baseUrl: "https://example.com/v1", models: ["one", "two"], apiKey: undefined } });
  });
  it("allows providers without predefined suggestions", () => {
    expect(validateProvider({ ...valid, models: [] }).ok).toBe(true);
  });
  it.each([null, {}, { ...valid, models: [" "] }, { ...valid, models: [12] }, { ...valid, name: " " },
    { ...valid, baseUrl: "file:///key" }, { ...valid, baseUrl: "https://user:secret@example.com" },
    { ...valid, apiKey: "secret\nvalue" }])("rejects malformed providers without echoing keys", (body) => {
    const result = validateProvider(body); expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("secret");
  });
});
