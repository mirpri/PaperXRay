import { DEFAULT_DOCUMENT_QUERY, DOCUMENT_SORTS, type DocumentListQuery, type DocumentSort } from "@paper-xray/contracts";

export function readLibraryQuery(params: URLSearchParams): DocumentListQuery {
  const sort = params.get("sort") as DocumentSort;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? DEFAULT_DOCUMENT_QUERY.pageSize);
  return {
    search: (params.get("q") ?? "").trim().slice(0, 200),
    sort: DOCUMENT_SORTS.includes(sort) ? sort : DEFAULT_DOCUMENT_QUERY.sort,
    page: Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1,
    pageSize: [20, 50, 100].includes(pageSize) ? pageSize : DEFAULT_DOCUMENT_QUERY.pageSize,
  };
}

export function libraryQueryParams(query: DocumentListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.sort !== DEFAULT_DOCUMENT_QUERY.sort) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== DEFAULT_DOCUMENT_QUERY.pageSize) params.set("pageSize", String(query.pageSize));
  return params;
}

/** A bounded set of page buttons, including both ends, even for huge libraries. */
export function libraryPageNumbers(page: number, total: number): (number | "gap")[] {
  const pages = new Set([1, total]);
  for (let n = Math.max(1, page - 2); n <= Math.min(total, page + 2); n++) pages.add(n);
  const result: (number | "gap")[] = [];
  let previous = 0;
  for (const n of [...pages].sort((a, b) => a - b)) {
    if (previous && n - previous > 1) result.push("gap");
    result.push(n); previous = n;
  }
  return result;
}
