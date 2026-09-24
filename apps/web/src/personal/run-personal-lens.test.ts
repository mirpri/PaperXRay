import { describe, expect, it, vi } from "vitest";
import type { LensSpec } from "@paper-xray/contracts";
import { runPersonalLens } from "./run-personal-lens";

const SPEC: LensSpec = {
  id: "personal-1",
  name: "Power",
  description: "d",
  version: "1",
  kind: "model",
  scope: "all",
  instruction: "Find stats without sample sizes.",
  outputSchema: { requiresEvidenceSpan: true, requiresComment: true, requiresSeverity: true },
  maxAnnotations: 2,
  executionContext: "personal-client",
  ownerId: "u1",
  strictScope: false,
  shareRunsWithOrg: false,
};

const SETTINGS = { baseUrl: "https://models.example/v1/", model: "m", apiKey: "sk-test" };

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("runPersonalLens", () => {
  it("calls the user's endpoint directly with their key and parses the quoted items", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      reply(JSON.stringify({ annotations: [{ evidenceText: "n = 12", comment: "small", severity: "high", confidence: 0.7 }] })),
    );
    const items = await runPersonalLens({ spec: SPEC, normalizedText: "We test n = 12 users.", settings: SETTINGS, fetchImpl });

    expect(items).toEqual([{ evidenceText: "n = 12", comment: "small", severity: "high", confidence: 0.7 }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://models.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body).messages[1].content).toBe("We test n = 12 users.");
  });

  it("omits the Authorization header for keyless local endpoints", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('{"annotations":[]}'));
    await runPersonalLens({ spec: SPEC, normalizedText: "x", settings: { ...SETTINGS, apiKey: "" }, fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("explains network/CORS failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(runPersonalLens({ spec: SPEC, normalizedText: "x", settings: SETTINGS, fetchImpl })).rejects.toThrow(
      /CORS/,
    );
  });

  it("surfaces non-2xx responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(runPersonalLens({ spec: SPEC, normalizedText: "x", settings: SETTINGS, fetchImpl })).rejects.toThrow(
      /401: bad key/,
    );
  });
});
