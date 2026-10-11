import { createServer, type Server } from "node:http";
import express from "express";
import type { User } from "@paper-xray/contracts";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), create: vi.fn(), extract: vi.fn(), build: vi.fn(), write: vi.fn(), fetch: vi.fn(), list: vi.fn() }));
vi.mock("../db/repositories.js", () => ({
  findDocumentByContentHash: mocks.find, createDocumentWithNodes: mocks.create,
  findUserById: vi.fn(), findDocumentById: vi.fn(), getCharMapForDocument: vi.fn(), insertAgentAnnotations: vi.fn(),
  listAgentAnnotationsForDoc: vi.fn(), listDocuments: mocks.list, listHumanAnnotationsForDoc: vi.fn(),
  listLensRunsForDocument: vi.fn(), listNodesForDocument: vi.fn(), recordLensRun: vi.fn(),
  setAgentRunVisibility: vi.fn(), findAgentRunOwner: vi.fn(),
}));
vi.mock("../storage/document-files.js", () => ({ writePdf: mocks.write, pdfPathForHash: vi.fn() }));
vi.mock("../extraction/extract-pages.js", () => ({ extractPdf: mocks.extract }));
vi.mock("../reassembly/build-document.js", () => ({ buildDocument: mocks.build }));
vi.mock("../lenses/run-org-lens.js", () => ({ runOrgLens: vi.fn() }));
vi.mock("../import/safe-fetch.js", () => ({ fetchPdf: mocks.fetch, ImportError: class extends Error {} }));
import { documentsRouter } from "./documents.js";
const document = { id: "paper", contentHash: "hash", title: "Automatically extracted title", pageCount: 1, normalizedText: "text", createdAt: "now" };
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (!req.headers["x-anonymous"]) req.user = { id: "alice", role: "member" } as User; next(); });
  app.use(documentsRouter);
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
beforeEach(() => {
  vi.resetAllMocks(); mocks.find.mockResolvedValue(null);
  mocks.extract.mockResolvedValue({ pages: [{ width: 600, height: 800, items: [] }], title: document.title });
  mocks.build.mockReturnValue({ normalizedText: "text", charMap: [], nodes: [] });
  mocks.create.mockResolvedValue({ document }); mocks.fetch.mockResolvedValue(Buffer.from("pdf"));
});
async function upload() {
  const form = new FormData(); form.append("file", new Blob(["pdf"], { type: "application/pdf" }), "original.pdf");
  return fetch(base + "/documents", { method: "POST", body: form });
}
it("saves the extracted title on first upload, without persisting the original filename", async () => {
  const response = await upload(); expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ document, deduped: false });
  expect(mocks.extract).toHaveBeenCalledWith(expect.any(Uint8Array), "original.pdf");
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: document.title }));
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("originalFilename");
});
it("uses the same extraction pipeline for URL imports", async () => {
  const response = await fetch(base + "/documents/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://arxiv.org/abs/1706.03762" }) });
  expect(response.status).toBe(201);
  expect(mocks.extract).toHaveBeenCalledWith(expect.any(Uint8Array), expect.stringContaining("1706.03762"));
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: document.title }));
});
it("keeps an administrator's saved title on duplicate upload without reprocessing", async () => {
  const existing = { ...document, title: "Admin's edited title" }; mocks.find.mockResolvedValue(existing);
  const response = await upload(); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ document: existing, deduped: true });
  expect(mocks.extract).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
});

it("serves search, sorting and pagination metadata to signed-in members", async () => {
  const result = { documents: [], total: 42, page: 2, pageSize: 20, totalPages: 3 };
  mocks.list.mockResolvedValue(result);
  const response = await fetch(base + "/documents?q=LLM&sort=title-asc&page=2&pageSize=20");
  expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
  expect(mocks.list).toHaveBeenCalledWith({ search: "LLM", sort: "title-asc", page: 2, pageSize: 20 });
});
it("rejects bad list parameters before querying the database", async () => {
  const response = await fetch(base + "/documents?pageSize=100000");
  expect(response.status).toBe(400); expect(mocks.list).not.toHaveBeenCalled();
});
it("requires login for paginated document listings", async () => {
  const response = await fetch(base + "/documents", { headers: { "x-anonymous": "true" } });
  expect(response.status).toBe(401); expect(mocks.list).not.toHaveBeenCalled();
});
