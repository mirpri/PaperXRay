import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@paper-xray/contracts";

const mocks = vi.hoisted(() => ({ document: vi.fn(), human: vi.fn(), insert: vi.fn(), edit: vi.fn() }));
vi.mock("../db/repositories.js", () => ({ findDocumentById: mocks.document, findHumanAnnotationById: mocks.human,
  findAgentAnnotationById: vi.fn(), insertHumanAnnotation: mocks.insert, updateHumanAnnotationBody: mocks.edit, softDeleteHumanAnnotation: vi.fn() }));
vi.mock("../realtime/socket.js", () => ({ broadcastAnnotationsChanged: vi.fn(), broadcastNotificationsChanged: vi.fn() }));
vi.mock("../db/notifications.js", () => ({ findNotificationRecipient: vi.fn() }));
vi.mock("../db/paper-subscriptions.js", () => ({ findPaperCommentRecipients: vi.fn().mockResolvedValue([]) }));
vi.mock("../lenses/ai-replies.js", () => ({ cancelAiReply: vi.fn() }));
import { humanAnnotationsRouter } from "./human-annotations.js";

const anchor = { nodeId: "node", charRange: { start: 0, end: 4 }, contextPrefix: "", contextSuffix: "" };
const comment = { id: "note", docId: "doc", authorId: "alice", body: "Note", visibility: "org", version: 1, anchor };
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers["x-user"] ?? "alice", role: "member", status: "active" } as User; next(); });
  app.use(humanAnnotationsRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  base = `http://127.0.0.1:${address.port}/documents/doc/human-annotations`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.document.mockResolvedValue({ id: "doc", normalizedText: "paper text" });
  mocks.human.mockResolvedValue(comment);
  mocks.insert.mockResolvedValue(comment);
  mocks.edit.mockResolvedValue({ ok: true, current: { ...comment, version: 2 } });
});
function request(method: string, suffix: string, body: object, user = "alice") {
  return fetch(base + suffix, { method, headers: { "Content-Type": "application/json", "x-user": user }, body: JSON.stringify(body) });
}
it("accepts preset colors when creating and editing owned annotations", async () => {
  expect((await request("POST", "", { anchor, body: "Note", color: "#3b6cb7" })).status).toBe(201);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ color: "#3b6cb7", authorId: "alice" }));
  expect((await request("PATCH", "/note", { body: "Edited", version: 1, color: "#168575" })).status).toBe(200);
  expect(mocks.edit).toHaveBeenCalledWith("note", 1, "Edited", "#168575");
});
it("rejects custom and malformed colors on create and edit", async () => {
  for (const color of ["#123ABC", "red", "#123", "#12345678", "url(example)", null, 123]) {
    expect((await request("POST", "", { anchor, body: "Note", color })).status).toBe(400);
    expect((await request("PATCH", "/note", { body: "Edited", version: 1, color })).status).toBe(400);
  }
  expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.edit).not.toHaveBeenCalled();
});
it("preserves existing colors when older clients omit the field", async () => {
  expect((await request("PATCH", "/note", { body: "Edited", version: 1 })).status).toBe(200);
  expect(mocks.edit).toHaveBeenCalledWith("note", 1, "Edited", undefined);
});
it("keeps ownership checks and version conflicts for color edits", async () => {
  const body = { body: "Note", version: 1, color: "#168575" };
  expect((await request("PATCH", "/note", body, "bob")).status).toBe(403);
  expect(mocks.edit).not.toHaveBeenCalled();
  mocks.edit.mockResolvedValue({ ok: false, current: { ...comment, version: 2 } });
  expect((await request("PATCH", "/note", body)).status).toBe(409);
});
