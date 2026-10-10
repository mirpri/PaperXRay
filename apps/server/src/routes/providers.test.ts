import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@paper-xray/contracts";
const mocks = vi.hoisted(() => ({ find: vi.fn(), list: vi.fn(), save: vi.fn(), remove: vi.fn(), lens: vi.fn(), update: vi.fn() }));
vi.mock("../db/providers.js", () => ({ findProvider: mocks.find, listProviders: mocks.list, saveProvider: mocks.save, deleteProvider: mocks.remove, ProviderConflict: class extends Error {} }));
vi.mock("../db/lens-repository.js", () => ({ findLensById: mocks.lens, updateLens: mocks.update, listLensesForUser: vi.fn(), insertLens: vi.fn(), deleteLens: vi.fn() }));
import { providersRouter } from "./providers.js";
import { lensesRouter } from "./lenses.js";
let server: Server; let base: string;
const draft = { name: "Provider", baseUrl: "https://api.example/v1", models: ["one"] };
const lensDraft = { name: "Lens", description: "", instruction: "Check this paper for evidence", scope: "all", maxAnnotations: 3, providerId: "org-provider-test", model: "one" };
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers["x-role"]) req.user = { id: "alice", role: req.headers["x-role"] } as User; next(); });
  app.use(lensesRouter); app.use(providersRouter);
  server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No address"); base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); });
beforeEach(() => {
  vi.resetAllMocks(); mocks.find.mockResolvedValue({ id: "org-provider-test", ownerId: null, models: ["one"] });
  mocks.save.mockResolvedValue({ id: "org-provider-test", ...draft, ownerId: null, hasApiKey: true });
  mocks.lens.mockResolvedValue({ id: "lens", ownerId: "alice" }); mocks.update.mockResolvedValue({ id: "lens" });
  mocks.list.mockResolvedValue([]);
});
function request(path: string, method: string, body?: unknown, role = "member") {
  return fetch(base + path, { method, headers: { "x-role": role, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
describe("provider and lens permissions", () => {
  it.each(["member", "curator"])("blocks %s from editing organization credentials", async (role) => {
    expect((await request("/providers", "POST", { ...draft, org: true }, role)).status).toBe(403);
    expect((await request("/providers/org-provider-test", "PUT", draft, role)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("allows admin organization creation without returning a key", async () => {
    const response = await request("/providers", "POST", { ...draft, org: true, apiKey: "private-key" }, "admin");
    expect(response.status).toBe(201); expect(await response.text()).not.toContain("private-key");
    expect(mocks.save).toHaveBeenCalledWith(null, null, expect.objectContaining({ apiKey: "private-key" }));
  });
  it("allows personal metadata and rejects personal credentials at the API boundary", async () => {
    expect((await request("/providers", "POST", draft)).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(null, "alice", expect.objectContaining({ name: "Provider" }));
    mocks.save.mockClear();
    expect((await request("/providers", "POST", { ...draft, apiKey: "personal-key" })).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("hides other users' personal providers, including from admins", async () => {
    mocks.find.mockResolvedValue({ ownerId: "bob", models: ["one"] });
    expect((await request("/providers/personal-provider-test", "PUT", draft, "admin")).status).toBe(404);
    expect((await request("/providers/personal-provider-test", "DELETE", undefined, "admin")).status).toBe(404);
  });
  it("allows personal lenses to select an organization provider", async () => {
    expect((await request("/lenses/lens", "PUT", lensDraft)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerId: "org-provider-test", model: "one" }));
  });
  it("blocks organization lenses from selecting personal providers", async () => {
    mocks.lens.mockResolvedValue({ id: "lens", ownerId: null }); mocks.find.mockResolvedValue({ ownerId: "alice", models: ["one"] });
    expect((await request("/lenses/lens", "PUT", lensDraft, "admin")).status).toBe(400);
  });
  it("blocks foreign personal providers while allowing models outside suggestions", async () => {
    mocks.find.mockResolvedValue({ ownerId: "bob", models: ["one"] });
    expect((await request("/lenses/lens", "PUT", lensDraft)).status).toBe(400);
    mocks.find.mockResolvedValue({ ownerId: null, models: ["two"] });
    expect((await request("/lenses/lens", "PUT", { ...lensDraft, model: "custom-model" })).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ model: "custom-model" }));
  });
  it("rejects unauthenticated provider access", async () => {
    expect((await fetch(base + "/providers")).status).toBe(401); expect(mocks.list).not.toHaveBeenCalled();
  });
});
