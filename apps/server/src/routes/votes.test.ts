import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { HumanAnnotation, User } from "@paper-xray/contracts";
const mocks = vi.hoisted(() => ({ human: vi.fn(), agent: vi.fn(), vote: vi.fn(), broadcast: vi.fn(), notify: vi.fn() }));
vi.mock("../db/repositories.js", () => ({ findHumanAnnotationById: mocks.human, findAgentAnnotationById: mocks.agent }));
vi.mock("../db/votes.js", () => ({ setAnnotationVote: mocks.vote }));
vi.mock("../realtime/socket.js", () => ({ broadcastAnnotationsChanged: mocks.broadcast, broadcastNotificationsChanged: mocks.notify }));
import { votesRouter } from "./votes.js";
const comment = { id: "comment", docId: "doc", authorId: "alice", visibility: "org", deletedAt: null } as HumanAnnotation;
let base: string; let server: Server;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers["x-user"]) req.user = { id: req.headers["x-user"], role: "admin" } as User; next(); });
  app.use(votesRouter);
  server = createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
beforeEach(() => {
  vi.resetAllMocks(); mocks.human.mockResolvedValue(comment);
  mocks.agent.mockResolvedValue({ id: "comment", docId: "doc", ownerId: "alice", visibility: "org" });
  mocks.vote.mockResolvedValue({ upvotes: 1, downvotes: 0, myVote: 1 });
});
function request(body: unknown, user = "bob") {
  return fetch(base + "/documents/doc/annotations/comment/vote", { method: "PUT", headers: { "Content-Type": "application/json", ...(user ? { "x-user": user } : {}) }, body: JSON.stringify(body) });
}
it("requires authentication", async () => { expect((await request({ kind: "human", value: 1 }, "")).status).toBe(401); expect(mocks.vote).not.toHaveBeenCalled(); });
it.each([null, "1", 2, -2, {}, 0.5])("rejects invalid vote %j", async value => { expect((await request({ kind: "human", value })).status).toBe(400); expect(mocks.vote).not.toHaveBeenCalled(); });
it("rejects invalid annotation kinds", async () => { expect((await request({ kind: "other", value: 1 })).status).toBe(400); });
it.each([-1, 0, 1])("sets vote %s with server-derived voter and recipient", async value => {
  const res = await request({ kind: "human", value, voterId: "forged", recipientId: "forged" });
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ votes: { upvotes: 1, downvotes: 0, myVote: 1 } });
  expect(mocks.vote).toHaveBeenCalledWith({ docId: "doc", annotationId: "comment", kind: "human", voterId: "bob", value, recipientId: "alice" });
  expect(mocks.broadcast).toHaveBeenCalledWith("doc"); expect(mocks.notify).toHaveBeenCalledWith("alice");
});
it("does not notify for a self vote", async () => {
  expect((await request({ kind: "human", value: 1 }, "alice")).status).toBe(200);
  expect(mocks.vote).toHaveBeenCalledWith(expect.objectContaining({ recipientId: null })); expect(mocks.notify).not.toHaveBeenCalled();
});
it("notifies personal Lens owners and leaves org Lens votes without a recipient", async () => {
  expect((await request({ kind: "agent", value: -1 })).status).toBe(200);
  expect(mocks.notify).toHaveBeenCalledWith("alice");
  mocks.notify.mockClear(); mocks.agent.mockResolvedValue({ id: "comment", docId: "doc", ownerId: null, visibility: "org" });
  expect((await request({ kind: "agent", value: 1 })).status).toBe(200);
  expect(mocks.vote).toHaveBeenLastCalledWith(expect.objectContaining({ recipientId: null })); expect(mocks.notify).not.toHaveBeenCalled();
});
it("does not let admins vote on another user's private annotation", async () => {
  mocks.human.mockResolvedValue({ ...comment, visibility: "private" });
  expect((await request({ kind: "human", value: 1 })).status).toBe(404);
  expect(mocks.vote).not.toHaveBeenCalled();
  expect((await request({ kind: "human", value: 1 }, "alice")).status).toBe(200);
});
it("checks the root of nested replies, including private Lens runs", async () => {
  mocks.human.mockResolvedValue({ ...comment, parentId: "parent", threadRootId: "root", threadRootKind: "agent" });
  mocks.agent.mockResolvedValue({ id: "root", docId: "doc", ownerId: "alice", visibility: "private" });
  expect((await request({ kind: "human", value: 1 })).status).toBe(404); expect(mocks.vote).not.toHaveBeenCalled();
  mocks.agent.mockResolvedValue({ id: "root", docId: "doc", ownerId: "alice", visibility: "org" });
  expect((await request({ kind: "human", value: 1 })).status).toBe(200);
});
it("rejects deleted, missing, and cross-document annotations", async () => {
  for (const target of [null, { ...comment, deletedAt: "now" }, { ...comment, docId: "other" }]) {
    mocks.human.mockResolvedValue(target); expect((await request({ kind: "human", value: 1 })).status).toBe(404);
  }
  expect(mocks.vote).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
});
