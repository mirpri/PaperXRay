import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(), transactionQuery: vi.fn(), getConnection: vi.fn(), beginTransaction: vi.fn(),
  commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), write: vi.fn(), text: vi.fn(), charMap: vi.fn(),
}));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query, getConnection: mocks.getConnection } }));
vi.mock("../storage/document-files.js", () => ({
  writeDocumentContent: mocks.write, readNormalizedText: mocks.text, readCharMap: mocks.charMap,
}));
import { createDocumentWithNodes, findDocumentById, getCharMapForDocument, updateDocumentTitle } from "./repositories.js";

const hash = "a".repeat(64);
const row = { id: "paper", content_hash: hash, title: "paper.pdf", page_count: 2, created_at: new Date("2026-01-01") };
const params = { contentHash: hash, title: "paper.pdf", pageCount: 2, normalizedText: "论文😀", charMap: [], nodes: [] };

describe("file-backed document repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getConnection.mockResolvedValue({ query: mocks.transactionQuery, beginTransaction: mocks.beginTransaction,
      commit: mocks.commit, rollback: mocks.rollback, release: mocks.release });
    mocks.query.mockResolvedValue([[row]]);
    mocks.text.mockResolvedValue(params.normalizedText);
    mocks.charMap.mockResolvedValue([]);
  });

  it("reads text and CharMap from storage using only database metadata", async () => {
    expect((await findDocumentById("paper"))?.normalizedText).toBe("论文😀");
    expect(await getCharMapForDocument("paper")).toEqual([]);
    expect(mocks.text).toHaveBeenCalledWith(hash);
    expect(mocks.charMap).toHaveBeenCalledWith(hash);
    expect(mocks.query.mock.calls.every(([sql]) => !/normalized_text|char_map|SELECT \*/.test(sql))).toBe(true);
  });

  it("updates only display metadata, including when saving the same title", async () => {
    mocks.query.mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([[row]]);
    expect(await updateDocumentTitle("paper", "paper.pdf")).toEqual({ id: "paper", contentHash: hash, title: "paper.pdf", pageCount: 2, createdAt: row.created_at.toISOString() });
    expect(mocks.query.mock.calls[0]).toEqual(["UPDATE documents SET title = ? WHERE id = ?", ["paper.pdf", "paper"]]);
    expect(mocks.text).not.toHaveBeenCalled(); expect(mocks.charMap).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it("returns null for a missing document title update", async () => {
    mocks.query.mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([[]]);
    expect(await updateDocumentTitle("missing", "New title")).toBeNull();
  });

  it("writes files before acquiring a connection and batches paragraph inserts", async () => {
    const nodes = Array.from({ length: 501 }, (_, order) => ({ id: String(order), type: "paragraph" as const,
      parentId: null, order, charRange: { start: order, end: order + 1 }, pageHint: 1 }));
    await createDocumentWithNodes({ ...params, nodes });
    expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.getConnection.mock.invocationCallOrder[0]);
    const [sql, values] = mocks.transactionQuery.mock.calls[0];
    expect(sql).not.toMatch(/normalized_text|char_map/);
    expect(values).toHaveLength(4);
    expect(mocks.transactionQuery).toHaveBeenCalledTimes(4);
    expect(mocks.transactionQuery.mock.calls.slice(1).map((call) => call[1][0].length)).toEqual([250, 250, 1]);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("does not begin a database transaction if file persistence fails", async () => {
    mocks.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(createDocumentWithNodes(params)).rejects.toThrow("disk full");
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it("rolls back database failures and releases the connection", async () => {
    mocks.transactionQuery.mockRejectedValueOnce(new Error("lock timeout"));
    await expect(createDocumentWithNodes(params)).rejects.toThrow("lock timeout");
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
