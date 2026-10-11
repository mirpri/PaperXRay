import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LibraryPagination } from "./LibraryPagination";
const noOp = () => {};
it("shows result range, accessible current page and bounded controls", () => {
  const html = renderToStaticMarkup(<LibraryPagination result={{ documents: Array(20).fill({}), total: 1000, page: 3, pageSize: 20, totalPages: 50 }} onPage={noOp} onPageSize={noOp} />);
  expect(html).toContain("41–60 of 1000 papers"); expect(html).toContain('aria-label="Page 3" aria-current="page"');
  expect(html).toContain('aria-label="Library pagination"'); expect(html).toContain('aria-label="Papers per page"');
  expect(html).not.toContain('aria-label="Page 25"');
});
it("handles empty results without offering invalid navigation", () => {
  const html = renderToStaticMarkup(<LibraryPagination result={{ documents: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }} onPage={noOp} onPageSize={noOp} />);
  expect(html).toContain("0–0 of 0 papers"); expect(html).not.toContain("Next page");
});
