import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), write: vi.fn(), text: vi.fn(), map: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { getConnection: async () => ({ query: mocks.query, release: mocks.release }) } }));
vi.mock("../storage/document-files.js", () => ({
  writeDocumentContent: mocks.write, readNormalizedText: mocks.text, readCharMap: mocks.map,
}));
import { externalizeDocumentContent } from "./externalize-content.js";
const columns = [[{ Field: "normalized_text" }, { Field: "char_map" }]];
const legacy = { id: "paper", content_hash: "a".repeat(64), normalized_text: "论文😀", char_map: "[]" };

describe("externalizing legacy content", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SHOW")) return columns;
      if (sql.startsWith("SELECT")) return [[legacy]];
      return [[]];
    });
    mocks.text.mockResolvedValue("论文😀");
    mocks.map.mockResolvedValue([]);
  });

  it("drops old fields only after all exported files are verified", async () => {
    let pages = 0;
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SHOW")) return columns;
      if (sql.startsWith("SELECT")) return [pages++ === 0 ? [legacy] : []];
      return [[]];
    });
    await externalizeDocumentContent();
    expect(mocks.write).toHaveBeenCalledWith(legacy.content_hash, "论文😀", []);
    const dropIndex = mocks.query.mock.calls.findIndex(([sql]) => sql.startsWith("ALTER TABLE"));
    expect(mocks.map.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[dropIndex]);
    expect(mocks.query).toHaveBeenLastCalledWith("UNLOCK TABLES");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("retains source fields and releases locks if file verification fails", async () => {
    mocks.text.mockResolvedValue("wrong content");
    await expect(externalizeDocumentContent()).rejects.toThrow("verification failed");
    expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("ALTER TABLE"))).toBe(false);
    expect(mocks.query).toHaveBeenLastCalledWith("UNLOCK TABLES");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("does not lock or modify an already converted database", async () => {
    mocks.query.mockResolvedValue([[{ Field: "content_hash" }]]);
    await externalizeDocumentContent();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
