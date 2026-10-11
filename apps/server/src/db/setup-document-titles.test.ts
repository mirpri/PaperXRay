import { beforeEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("./pool.js", () => ({ pool: { query } }));
import { setupDocumentTitles } from "./setup-document-titles.js";
beforeEach(() => query.mockReset());
it("renames the existing column without copying or deleting document records", async () => {
  query.mockResolvedValueOnce([[{ Field: "id" }, { Field: "original_filename" }]]).mockResolvedValue([[]]);
  await setupDocumentTitles();
  expect(query).toHaveBeenLastCalledWith("ALTER TABLE documents CHANGE COLUMN original_filename title VARCHAR(500) NULL");
  expect(query).toHaveBeenCalledTimes(2);
});
it("is a no-op on an updated database", async () => {
  query.mockResolvedValueOnce([[{ Field: "title" }]]);
  await setupDocumentTitles(); expect(query).toHaveBeenCalledTimes(1);
});
it("adds a missing column on a database without either field", async () => {
  query.mockResolvedValueOnce([[{ Field: "id" }]]).mockResolvedValue([[]]);
  await setupDocumentTitles();
  expect(query).toHaveBeenLastCalledWith("ALTER TABLE documents ADD COLUMN title VARCHAR(500) NULL");
});
it("retains saved titles if both columns exist after a manual upgrade", async () => {
  query.mockResolvedValueOnce([[{ Field: "title" }, { Field: "original_filename" }]]).mockResolvedValue([[]]);
  await setupDocumentTitles();
  expect(query.mock.calls.slice(1).map(call => call[0])).toEqual([
    "UPDATE documents SET title = original_filename WHERE title IS NULL",
    "ALTER TABLE documents DROP COLUMN original_filename",
  ]);
});
