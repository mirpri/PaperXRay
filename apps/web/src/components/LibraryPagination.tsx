import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DocumentPage } from "@paper-xray/contracts";
import { libraryPageNumbers } from "../pages/library-query";

export function LibraryPagination({ result, onPage, onPageSize }: {
  result: DocumentPage;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const { page, pageSize, total, totalPages, documents } = result;
  const start = total ? (page - 1) * pageSize + 1 : 0;
  return <div className="pxr-library-pagination">
    <span className="pxr-library-result-count" role="status">{start}–{total ? start + documents.length - 1 : 0} of {total} papers</span>
    {totalPages > 1 && <nav aria-label="Library pagination">
      <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={14} aria-hidden="true" /></button>
      {libraryPageNumbers(page, totalPages).map((n, index) => n === "gap" ? <span key={`gap-${index}`} aria-hidden="true">…</span>
        : <button key={n} type="button" aria-label={`Page ${n}`} aria-current={page === n ? "page" : undefined} onClick={() => onPage(n)}>{n}</button>)}
      <button type="button" aria-label="Next page" disabled={page === totalPages} onClick={() => onPage(page + 1)}><ChevronRight size={14} aria-hidden="true" /></button>
    </nav>}
    <label className="pxr-library-page-size">Per page
      <select aria-label="Papers per page" value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>
        {[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
  </div>;
}
