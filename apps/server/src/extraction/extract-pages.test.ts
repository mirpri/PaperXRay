import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ open: vi.fn(), metadata: vi.fn(), page: vi.fn(), destroy: vi.fn(), text: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: mocks.open }));
import { extractPdf } from "./extract-pages.js";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.open.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getMetadata: mocks.metadata, getPage: mocks.page, destroy: mocks.destroy }) });
  mocks.page.mockResolvedValue({ getTextContent: mocks.text, view: [0, 0, 600, 800] });
  mocks.text.mockResolvedValue({ items: [{ str: "Body text", transform: [10, 0, 0, 10, 60, 400], width: 80, height: 10, fontName: "font" }] });
  mocks.metadata.mockResolvedValue({ info: { Title: "Information dictionary title" }, metadata: { get: () => "Metadata title" } });
});
it("reads the title and pages from one PDF instance and always releases it", async () => {
  const result = await extractPdf(new Uint8Array([1]), "file.pdf");
  expect(result.title).toBe("Metadata title"); expect(result.pages).toHaveLength(1);
  expect(mocks.open).toHaveBeenCalledOnce(); expect(mocks.text).toHaveBeenCalledOnce(); expect(mocks.destroy).toHaveBeenCalledOnce();
  expect(result.pages[0].items[0]).toMatchObject({ itemIndex: 0, str: "Body text" });
});
it("falls back when metadata is missing or broken", async () => {
  mocks.metadata.mockRejectedValue(new Error("Bad metadata"));
  expect((await extractPdf(new Uint8Array([1]), "file.pdf")).title).toBe("file.pdf");
  expect(mocks.destroy).toHaveBeenCalledOnce();
});
it("also reads Title when XMP metadata is absent", async () => {
  mocks.metadata.mockResolvedValue({ info: { Title: "Dictionary title" }, metadata: null });
  expect((await extractPdf(new Uint8Array([1]))).title).toBe("Dictionary title");
});
