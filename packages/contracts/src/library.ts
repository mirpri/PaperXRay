import type { DocumentSummary } from "./ir.js";

export const DOCUMENT_SORTS = ["newest", "oldest", "title-asc", "title-desc", "pages-asc", "pages-desc"] as const;
export type DocumentSort = typeof DOCUMENT_SORTS[number];

export interface DocumentListQuery {
  search: string;
  sort: DocumentSort;
  page: number;
  pageSize: number;
}

export interface DocumentPage {
  documents: DocumentSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const DEFAULT_DOCUMENT_QUERY: DocumentListQuery = { search: "", sort: "newest", page: 1, pageSize: 20 };
