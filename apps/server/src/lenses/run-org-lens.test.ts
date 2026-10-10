import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LensSpec } from "@paper-xray/contracts";
const mocks = vi.hoisted(() => ({ find: vi.fn(), model: vi.fn(), fake: vi.fn() }));
vi.mock("../db/lens-model-config.js", () => ({ findLensModelConfig: mocks.find }));
vi.mock("./run-model-lens.js", () => ({ runModelLens: mocks.model }));
vi.mock("./fake-lens.js", () => ({ runFakeLens: mocks.fake }));
import { runOrgLens } from "./run-org-lens.js";
const spec = { id: "org-lens", executionContext: "org-server", ownerId: null } as LensSpec;
const params = { spec, docId: "paper", normalizedText: "Paper text", nodes: [] };
describe("org lens endpoint selection", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.find.mockResolvedValue(null); mocks.model.mockResolvedValue([]); });
  it("uses the saved endpoint even without an API key", async () => {
    const endpoint = { baseUrl: "http://localhost:11434/v1", model: "local", apiKey: "" };
    mocks.find.mockResolvedValue(endpoint);
    await runOrgLens(params);
    expect(mocks.find).toHaveBeenCalledWith("org-lens");
    expect(mocks.model).toHaveBeenCalledWith({ ...params, modelConfig: endpoint });
    expect(mocks.fake).not.toHaveBeenCalled();
  });
  it("rejects an unconfigured lens without calling a model or producing fake results", async () => {
    await expect(runOrgLens(params)).rejects.toThrow("no model API configured");
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.fake).not.toHaveBeenCalled();
  });
  it("surfaces a custom API failure without switching models", async () => {
    mocks.find.mockResolvedValue({ baseUrl: "https://custom.example/v1", model: "custom", apiKey: "key" });
    mocks.model.mockRejectedValue(new Error("HTTP 401"));
    await expect(runOrgLens(params)).rejects.toThrow("HTTP 401");
    expect(mocks.fake).not.toHaveBeenCalled();
  });
  it("rejects personal lenses before looking up server credentials", async () => {
    await expect(runOrgLens({ ...params, spec: { ...spec, executionContext: "personal-client" } })).rejects.toThrow("Lenses using personal providers run in the browser");
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
