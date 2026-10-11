import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_DOCUMENT_QUERY } from "@paper-xray/contracts";
const query = vi.hoisted(() => vi.fn());
vi.mock("./pool.js", () => ({ pool: { query } }));
import { listDocuments } from "./repositories.js";
import { setupLibraryIndexes } from "./setup-library.js";
const row = { id: "doc", content_hash: "hash", title: "Research paper", page_count: 7, created_at: new Date("2026-01-01") };
beforeEach(() => query.mockReset());
it("returns a bounded metadata page and count in stable default order", async () => {
  query.mockResolvedValueOnce([[{ total: "51" }]]).mockResolvedValueOnce([[row]]);
  const result = await listDocuments({ ...DEFAULT_DOCUMENT_QUERY, page: 2 });
  expect(result).toMatchObject({ total: 51, page: 2, pageSize: 20, totalPages: 3, documents: [{ title: "Research paper" }] });
  expect(query.mock.calls[1]).toEqual([expect.stringContaining("ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"), [20, 20]]);
  expect(query.mock.calls.every(([sql]) => !/normalized_text|char_map|SELECT \*/.test(sql))).toBe(true);
});
it("binds search text and escapes LIKE wildcards literally for both queries", async () => {
  query.mockResolvedValueOnce([[{ total: 1 }]]).mockResolvedValueOnce([[row]]);
  await listDocuments({ ...DEFAULT_DOCUMENT_QUERY, search: "O'Reilly 100%_!", sort: "title-asc" });
  for (const [sql, values] of query.mock.calls) {
    expect(sql).toContain("WHERE title LIKE ? ESCAPE '!'");
    expect(sql).not.toContain("O'Reilly"); expect(values[0]).toBe("%O'Reilly 100!%!_!!%");
  }
  expect(query.mock.calls[1][0]).toContain("ORDER BY title ASC, id ASC");
});
it.each([
  ["oldest", "created_at ASC, id ASC"], ["title-desc", "title DESC, id DESC"],
  ["pages-asc", "page_count ASC, id ASC"], ["pages-desc", "page_count DESC, id DESC"],
] as const)("supports %s with a deterministic tie breaker", async (sort, order) => {
  query.mockResolvedValueOnce([[{ total: 1 }]]).mockResolvedValueOnce([[row]]);
  await listDocuments({ ...DEFAULT_DOCUMENT_QUERY, sort }); expect(query.mock.calls[1][0]).toContain(`ORDER BY ${order}`);
});
it("clamps out-of-range pages after a search or title edit", async () => {
  query.mockResolvedValueOnce([[{ total: 21 }]]).mockResolvedValueOnce([[row]]);
  expect(await listDocuments({ ...DEFAULT_DOCUMENT_QUERY, page: 100 })).toMatchObject({ page: 2, totalPages: 2 });
  expect(query.mock.calls[1][1]).toEqual([20, 20]);
});
it("returns an empty first page for an empty library or search", async () => {
  query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);
  expect(await listDocuments({ ...DEFAULT_DOCUMENT_QUERY, page: 5 })).toEqual({ documents: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
});
it("adds only missing indexes and leaves existing ones intact", async () => {
  query.mockResolvedValueOnce([[{ Key_name: "PRIMARY" }, { Key_name: "idx_documents_title" }]]).mockResolvedValue([[]]);
  await setupLibraryIndexes();
  expect(query.mock.calls.slice(1)).toEqual([
    ["ALTER TABLE documents ADD INDEX idx_documents_created (created_at, id)"],
    ["ALTER TABLE documents ADD INDEX idx_documents_pages (page_count, id)"],
  ]);
});
