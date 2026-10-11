import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { DocumentListItem } from "./DocumentListItem";
const document = { id: "paper", contentHash: "abc12345", title: "Extracted paper title", pageCount: 2, createdAt: "2026-01-01" };
function render(canEdit: boolean) {
  return renderToStaticMarkup(<MemoryRouter><DocumentListItem document={document} canEdit={canEdit} onChanged={() => {}} /></MemoryRouter>);
}
it("renders the extracted title as a reader link and an accessible edit action for admins", () => {
  const html = render(true);
  expect(html).toContain('href="/documents/paper"'); expect(html).toContain("Extracted paper title");
  expect(html).toContain('aria-label="Edit title: Extracted paper title"');
  expect(html).not.toMatch(/<button[^>]*>\s*<a/);
});
it("does not offer editing for other users", () => {
  expect(render(false)).not.toContain("Edit title");
});
