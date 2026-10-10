import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HumanAnnotation, User } from "@paper-xray/contracts";
const mocks = vi.hoisted(() => ({ document: vi.fn(), human: vi.fn(), agent: vi.fn(), insert: vi.fn(), edit: vi.fn(), remove: vi.fn(), broadcast: vi.fn(), notify: vi.fn() }));
vi.mock("../db/repositories.js", () => ({ findDocumentById: mocks.document, findHumanAnnotationById: mocks.human, findAgentAnnotationById: mocks.agent, insertHumanAnnotation: mocks.insert, updateHumanAnnotationBody: mocks.edit, softDeleteHumanAnnotation: mocks.remove }));
vi.mock("../realtime/socket.js", () => ({ broadcastAnnotationsChanged: mocks.broadcast, broadcastNotificationsChanged: mocks.notify }));
vi.mock("../db/notifications.js", () => ({ findNotificationRecipient: vi.fn().mockResolvedValue(null) }));
import { humanAnnotationsRouter } from "./human-annotations.js";
const anchor = { nodeId: "node", charRange: { start: 0, end: 10 }, contextPrefix: "", contextSuffix: "" };
const comment: HumanAnnotation = { id: "comment", docId: "doc", authorId: "alice", authorRole: "member", authorName: "Alice", anchor, body: "Original", visibility: "org", version: 1, createdAt: "now", updatedAt: "now", deletedAt: null };
let base: string; let server: Server;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers["x-user"]) req.user = { id: req.headers["x-user"], role: req.headers["x-role"] ?? "member" } as User; next(); });
  app.use(humanAnnotationsRouter);
  server = createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
beforeEach(() => {
  vi.resetAllMocks(); mocks.document.mockResolvedValue({ id: "doc" }); mocks.human.mockResolvedValue(comment);
  mocks.edit.mockResolvedValue({ ok: true, current: { ...comment, version: 2 } }); mocks.remove.mockResolvedValue({ ok: true, current: { ...comment, deletedAt: "now" } });
  mocks.insert.mockResolvedValue({ ...comment, id: "new" });
});
function request(method: string, path: string, body?: unknown, user = "alice", role = "member") {
  return fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(user ? { "x-user": user, "x-role": role } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const path = "/documents/doc/human-annotations/comment";
const replyPath = "/documents/doc/annotations/comment/replies";
describe("comment permissions and optimistic updates", () => {
  it("requires authentication for edit, delete, and reply", async () => {
    for (const [method, url, body] of [["PATCH", path, { body: "edit", version: 1 }], ["DELETE", path + "?version=1", undefined], ["POST", replyPath, { body: "reply", parentKind: "human" }]] as const) {
      expect((await request(method, url, body, "")).status).toBe(401);
    }
    expect(mocks.edit).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("allows the author to edit and trims the body", async () => {
    expect((await request("PATCH", path, { body: " Edited ", version: 1 })).status).toBe(200);
    expect(mocks.edit).toHaveBeenCalledWith("comment", 1, "Edited"); expect(mocks.broadcast).toHaveBeenCalledWith("doc");
  });
  it.each(["member", "curator", "admin"])("does not allow a %s to edit somebody else's comment", async role => {
    expect((await request("PATCH", path, { body: "Edited", version: 1 }, "bob", role)).status).toBe(403);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("allows authors to delete their comments", async () => {
    expect((await request("DELETE", path + "?version=1")).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith("comment", 1, "alice", "member");
  });
  it.each(["member", "curator"] as const)("allows admins to delete %s comments", async authorRole => {
    mocks.human.mockResolvedValue({ ...comment, authorRole });
    expect((await request("DELETE", path + "?version=1", undefined, "bob", "admin")).status).toBe(204);
  });
  it("blocks admins from deleting another admin's comment, but allows their own", async () => {
    mocks.human.mockResolvedValue({ ...comment, authorRole: "admin" });
    expect((await request("DELETE", path + "?version=1", undefined, "bob", "admin")).status).toBe(403);
    expect((await request("DELETE", path + "?version=1", undefined, "alice", "admin")).status).toBe(204);
  });
  it.each(["member", "curator"])("blocks a %s from deleting others' comments", async role => {
    expect((await request("DELETE", path + "?version=1", undefined, "bob", role)).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("returns current state on edit/delete version conflicts without broadcasting", async () => {
    mocks.edit.mockResolvedValue({ ok: false, current: { ...comment, version: 2 } }); mocks.remove.mockResolvedValue({ ok: false, current: comment });
    const res = await request("PATCH", path, { body: "edit", version: 1 }); expect(res.status).toBe(409); expect((await res.json() as { current: HumanAnnotation }).current.version).toBe(2);
    expect((await request("DELETE", path + "?version=1")).status).toBe(409); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("rejects blank bodies and invalid versions", async () => {
    for (const body of [" ", "x".repeat(10001), null]) expect((await request("PATCH", path, { body, version: 1 })).status).toBe(400);
    for (const version of [0, -1, 1.5, "1", null]) expect((await request("PATCH", path, { body: "edit", version })).status).toBe(400);
    expect((await request("DELETE", path + "?version=1.5")).status).toBe(400);
  });
  it("does not edit or delete removed comments or comments from other documents", async () => {
    for (const existing of [{ ...comment, deletedAt: "now" }, { ...comment, docId: "other" }]) {
      mocks.human.mockResolvedValue(existing);
      expect((await request("PATCH", path, { body: "edit", version: 1 })).status).toBe(404);
      expect((await request("DELETE", path + "?version=1")).status).toBe(404);
    }
  });
});
describe("nested replies and visibility", () => {
  it("lets any member reply and derives author, root, anchor and visibility server-side", async () => {
    expect((await request("POST", replyPath, { body: " Reply ", parentKind: "human", authorId: "forged", visibility: "private", threadRootId: "forged" }, "bob")).status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith({ notifyRecipientId: "alice", docId: "doc", authorId: "bob", anchor, body: "Reply", visibility: "org", parentId: "comment", parentKind: "human", threadRootId: "comment", threadRootKind: "human" });
  });
  it("notifies only the immediate human author, and never for a self-reply", async () => {
    await request("POST", replyPath, { body: "Reply", parentKind: "human" }, "bob");
    expect(mocks.notify).toHaveBeenCalledWith("alice");
    mocks.notify.mockClear(); mocks.insert.mockClear();
    await request("POST", replyPath, { body: "Self reply", parentKind: "human" });
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty("notifyRecipientId");
  });
  it("replies to replies inherit the original thread root", async () => {
    mocks.human.mockImplementation(async (id: string) => id === "comment" ? { ...comment, id: "comment", parentId: "root", parentKind: "human", threadRootId: "root", threadRootKind: "human" } : { ...comment, id: "root" });
    expect((await request("POST", replyPath, { body: "Nested", parentKind: "human" }, "bob")).status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ parentId: "comment", threadRootId: "root" }));
  });
  it("supports Lens threads, including nested replies", async () => {
    mocks.agent.mockResolvedValue({ id: "lens", docId: "doc", ownerId: null, visibility: "org", anchor });
    expect((await request("POST", "/documents/doc/annotations/lens/replies", { body: "Reply", parentKind: "agent" })).status).toBe(201);
    expect(mocks.insert).toHaveBeenLastCalledWith(expect.objectContaining({ parentKind: "agent", threadRootId: "lens", threadRootKind: "agent" }));
    mocks.human.mockResolvedValue({ ...comment, parentId: "lens", parentKind: "agent", threadRootId: "lens", threadRootKind: "agent" });
    expect((await request("POST", replyPath, { body: "Nested", parentKind: "human" })).status).toBe(201);
    expect(mocks.insert).toHaveBeenLastCalledWith(expect.objectContaining({ parentKind: "human", threadRootKind: "agent", threadRootId: "lens" }));
  });
  it("does not expose private human threads even to admins", async () => {
    mocks.human.mockResolvedValue({ ...comment, visibility: "private" });
    expect((await request("POST", replyPath, { body: "Reply", parentKind: "human" }, "bob", "admin")).status).toBe(404);
    expect((await request("DELETE", path + "?version=1", undefined, "bob", "admin")).status).toBe(404);
    expect((await request("POST", replyPath, { body: "Reply", parentKind: "human" })).status).toBe(201);
  });
  it("hides replies when the Lens root is made private, including from the reply author", async () => {
    mocks.human.mockResolvedValue({ ...comment, parentId: "lens", parentKind: "agent", threadRootId: "lens", threadRootKind: "agent" });
    mocks.agent.mockResolvedValue({ id: "lens", docId: "doc", ownerId: "bob", visibility: "private", anchor });
    expect((await request("PATCH", path, { body: "edit", version: 1 })).status).toBe(404);
    expect((await request("POST", replyPath, { body: "Reply", parentKind: "human" })).status).toBe(404);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("retains deleted-parent context for further replies", async () => {
    mocks.human.mockResolvedValue({ ...comment, body: "", deletedAt: "now" });
    expect((await request("POST", replyPath, { body: "Reply", parentKind: "human" }, "bob")).status).toBe(201);
  });
  it("rejects cross-document parents, unknown parents, invalid kinds and blank bodies", async () => {
    mocks.human.mockResolvedValue({ ...comment, docId: "other" });
    expect((await request("POST", replyPath, { body: "Reply", parentKind: "human" })).status).toBe(404);
    mocks.human.mockResolvedValue(null);
    expect((await request("POST", replyPath, { body: "Reply", parentKind: "human" })).status).toBe(404);
    expect((await request("POST", replyPath, { body: "Reply", parentKind: "invalid" })).status).toBe(400);
    expect((await request("POST", replyPath, { body: " ", parentKind: "human" })).status).toBe(400);
  });
});
