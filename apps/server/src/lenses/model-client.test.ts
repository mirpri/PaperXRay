import { afterEach, describe, expect, it, vi } from "vitest";
import { callChatModel } from "./model-client.js";
describe("per-lens model requests", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the chosen endpoint, model and key for each call", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "result" } }] }) });
    vi.stubGlobal("fetch", request);
    await callChatModel([], { baseUrl: "https://first.example/v1/", model: "first", apiKey: "key-one" });
    await callChatModel([], { baseUrl: "http://localhost:11434/v1", model: "second", apiKey: "" });
    expect(request.mock.calls[0][0]).toBe("https://first.example/v1/chat/completions");
    expect(request.mock.calls[0][1].headers.Authorization).toBe("Bearer key-one");
    expect(JSON.parse(request.mock.calls[0][1].body).model).toBe("first");
    expect(request.mock.calls[1][1].headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(request.mock.calls[1][1].body).model).toBe("second");
  });
  it("does not echo provider error bodies that may include credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "secret-key" }));
    await expect(callChatModel([], { baseUrl: "https://api.example/v1", model: "model", apiKey: "secret-key" })).rejects.toThrow(/^Model call failed: HTTP 401$/);
  });
});
