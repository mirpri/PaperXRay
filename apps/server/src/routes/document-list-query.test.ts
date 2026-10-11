import { expect, it } from "vitest";
import { parseDocumentListQuery } from "./document-list-query.js";
it("defaults to the first 20 papers, newest first", () => {
  expect(parseDocumentListQuery({})).toEqual({ search: "", sort: "newest", page: 1, pageSize: 20 });
});
it("trims searches and accepts a bounded page and supported sort", () => {
  expect(parseDocumentListQuery({ q: "  论文  ", sort: "pages-desc", page: "3", pageSize: "50" }))
    .toEqual({ search: "论文", sort: "pages-desc", page: 3, pageSize: 50 });
});
it.each([
  { q: [] }, { q: {} }, { q: "x".repeat(201) }, { sort: "title; DROP TABLE documents" }, { sort: [] },
  { page: "0" }, { page: "-1" }, { page: "1.5" }, { page: "1e3" }, { page: "1000001" }, { page: ["1", "2"] },
  { pageSize: "0" }, { pageSize: "101" }, { pageSize: "-1" }, { pageSize: {} },
])("rejects malformed or unbounded queries %j", input => {
  expect(() => parseDocumentListQuery(input)).toThrow();
});
