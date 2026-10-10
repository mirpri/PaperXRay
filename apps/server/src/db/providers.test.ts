import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query, getConnection: async () => ({ query: mocks.tx, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }) } }));
import { deleteProvider, listProviders, saveProvider } from "./providers.js";
import { findLensModelConfig } from "./lens-model-config.js";
const draft = { name: "Provider", baseUrl: "https://api.example/v1", models: ["one"] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.query.mockResolvedValue([[{ id: "provider", owner_id: null, name: "Provider", base_url: draft.baseUrl, models: '["one"]', has_api_key: 1 }]]);
  mocks.tx.mockImplementation(async (sql: string) => sql.startsWith("SELECT api_key") ? [[{ api_key: "stored-key" }]] : [[]]);
});
describe("provider storage", () => {
  it("lists only organization and caller metadata without retrieving credentials", async () => {
    const providers = await listProviders("alice");
    expect(providers[0]).not.toHaveProperty("apiKey");
    expect(mocks.query.mock.calls[0][0]).toContain("owner_id IS NULL OR owner_id = ?");
    expect(mocks.query.mock.calls[0][1]).toEqual(["alice"]);
  });
  it.each([[undefined, "stored-key"], [null, null], ["new-key", "new-key"]])("keeps, removes and replaces organization keys", async (apiKey, expected) => {
    await saveProvider("org-provider-test", null, { ...draft, apiKey });
    const insert = mocks.tx.mock.calls.find(([sql]) => sql.startsWith("INSERT")); expect(insert?.[1][5]).toBe(expected);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });
  it("never stores a personal key even if called directly with one", async () => {
    await saveProvider("personal-provider-test", "alice", { ...draft, apiKey: "private-key" });
    const insert = mocks.tx.mock.calls.find(([sql]) => sql.startsWith("INSERT")); expect(insert?.[1][5]).toBeNull();
  });
  it("allows suggestions to change without altering selected models", async () => {
    mocks.tx.mockImplementation(async (sql: string) => sql.startsWith("SELECT id, model") ? [[{ id: "lens", model: "removed", version: "1" }]] : [[]]);
    await saveProvider("provider", null, { ...draft, models: [] });
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.tx).toHaveBeenCalledWith("UPDATE lenses SET version = ? WHERE id = ?", ["2", "lens"]);
  });
  it("blocks deletion of a provider still used by a lens", async () => {
    mocks.tx.mockImplementation(async (sql: string) => sql.startsWith("SELECT id FROM lenses") ? [[{ id: "lens" }]] : [[]]);
    await expect(deleteProvider("provider")).rejects.toThrow("used by a lens"); expect(mocks.rollback).toHaveBeenCalledOnce();
  });
  it("resolves only the selected organization's model on the server", async () => {
    mocks.query.mockResolvedValue([[{ base_url: draft.baseUrl, api_key: "org-key", models: '["one"]', model: "custom-model" }]]);
    expect(await findLensModelConfig("lens")).toEqual({ baseUrl: draft.baseUrl, model: "custom-model", apiKey: "org-key" });
    expect(mocks.query.mock.calls[0][0]).toContain("p.owner_id IS NULL");
  });
});
