import { expect, it } from "vitest";
import { libraryPageNumbers, libraryQueryParams, readLibraryQuery } from "./library-query";
it("round-trips search, sort and pagination in shareable URLs", () => {
  const query = { search: "论文 & LLM", sort: "title-asc" as const, page: 3, pageSize: 50 };
  expect(readLibraryQuery(libraryQueryParams(query))).toEqual(query);
});
it("falls back from malformed URL parameters", () => {
  expect(readLibraryQuery(new URLSearchParams("page=-2&pageSize=1000&sort=nope"))).toEqual({ search: "", sort: "newest", page: 1, pageSize: 20 });
});
it("omits defaults from the URL", () => {
  expect(libraryQueryParams(readLibraryQuery(new URLSearchParams())).toString()).toBe("");
});
it("keeps page controls bounded for large libraries", () => {
  expect(libraryPageNumbers(50_000, 100_000)).toEqual([1, "gap", 49_998, 49_999, 50_000, 50_001, 50_002, "gap", 100_000]);
  expect(libraryPageNumbers(1, 1)).toEqual([1]);
  expect(libraryPageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
  expect(libraryPageNumbers(4, 4)).toEqual([1, 2, 3, 4]);
});
