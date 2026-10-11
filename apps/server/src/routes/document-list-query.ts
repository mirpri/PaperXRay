import { DEFAULT_DOCUMENT_QUERY, DOCUMENT_SORTS, type DocumentListQuery, type DocumentSort } from "@paper-xray/contracts";

/** Reject arrays/objects and unbounded pagination before passing anything to SQL. */
export function parseDocumentListQuery(query: Record<string, unknown>): DocumentListQuery {
  const search = query.q === undefined ? "" : query.q;
  if (typeof search !== "string" || search.trim().length > 200) throw new Error("Search must be at most 200 characters");
  const sort = query.sort ?? DEFAULT_DOCUMENT_QUERY.sort;
  if (typeof sort !== "string" || !DOCUMENT_SORTS.includes(sort as DocumentSort)) throw new Error("Invalid document sort");
  function integer(value: unknown, fallback: number, max: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw new Error("Invalid pagination");
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > max) throw new Error("Invalid pagination");
    return number;
  }
  return { search: search.trim(), sort: sort as DocumentSort,
    page: integer(query.page, DEFAULT_DOCUMENT_QUERY.page, 1_000_000),
    pageSize: integer(query.pageSize, DEFAULT_DOCUMENT_QUERY.pageSize, 100) };
}
