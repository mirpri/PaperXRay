import { createServer, type Server } from "node:http";
import express from "express";
import type { User } from "@paper-xray/contracts";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn(), broadcast: vi.fn() }));
vi.mock("../db/repositories.js", () => ({ updateDocumentTitle: mocks.update, findUserById: vi.fn() }));
vi.mock("../realtime/socket.js", () => ({ broadcastDocumentChanged: mocks.broadcast }));
import { documentTitlesRouter } from "./document-titles.js";
let server: Server, base: string;
const document = { id: "paper", contentHash: "hash", title: "New title", pageCount: 2, createdAt: "now" };
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers["x-role"]) req.user = { id: "alice", role: req.headers["x-role"] } as User; next(); });
  app.use(documentTitlesRouter);
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
beforeEach(() => { vi.resetAllMocks(); mocks.update.mockResolvedValue(document); });
function save(body: unknown, role = "admin") {
  return fetch(base + "/documents/paper", { method: "PATCH", headers: { "Content-Type": "application/json", ...(role ? { "x-role": role } : {}) }, body: JSON.stringify(body) });
}
it("saves a trimmed title and broadcasts lightweight document metadata", async () => {
  const response = await save({ title: "  New title  " });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ document });
  expect(mocks.update).toHaveBeenCalledWith("paper", "New title");
  expect(mocks.broadcast).toHaveBeenCalledWith(document);
});
it.each(["", "member", "curator"])("rejects title updates from role %j", async role => {
  expect((await save({ title: "New title" }, role)).status).toBe(role ? 403 : 401);
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
});
it.each([{}, { title: null }, { title: 42 }, { title: "  " }, { title: "x".repeat(501) }, { title: "line\nbreak" }, null])("rejects invalid input %j", async body => {
  expect((await save(body)).status).toBe(400); expect(mocks.update).not.toHaveBeenCalled();
});
it("accepts a 500-character Unicode title", async () => {
  expect((await save({ title: "论".repeat(500) })).status).toBe(200);
});
it("does not broadcast changes for a missing document", async () => {
  mocks.update.mockResolvedValue(null);
  expect((await save({ title: "New title" })).status).toBe(404); expect(mocks.broadcast).not.toHaveBeenCalled();
});
