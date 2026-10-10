import { createServer, type Server } from "node:http";
import express from "express";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@paper-xray/contracts";
const mocks = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn(), read: vi.fn(), all: vi.fn(), broadcast: vi.fn() }));
vi.mock("../db/notifications.js", async original => {
  const actual = await original<typeof import("../db/notifications.js")>();
  return { ...actual, listNotifications: mocks.list, countUnreadNotifications: mocks.count, markNotificationRead: mocks.read, markAllNotificationsRead: mocks.all };
});
vi.mock("../realtime/socket.js", () => ({ broadcastNotificationsChanged: mocks.broadcast }));
import { notificationsRouter } from "./notifications.js";
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.user = { id: req.headers["x-user"] } as User; next(); });
  app.use(notificationsRouter); app.get("/other", (_req, res) => res.json({ ok: true }));
  server = createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing address"); base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ notifications: [], nextCursor: null }); mocks.count.mockResolvedValue(3); mocks.read.mockResolvedValue(true); });
function request(method: string, path: string, user = "alice") { return fetch(base + path, { method, headers: user ? { "x-user": user } : {} }); }
it("requires authentication on all message routes without affecting other routes", async () => {
  for (const [method, path] of [["GET", "/notifications"], ["GET", "/notifications/unread-count"], ["PATCH", "/notifications/n/read"], ["POST", "/notifications/read-all"]]) expect((await request(method, path, "")).status).toBe(401);
  expect((await request("GET", "/other", "")).status).toBe(200);
});
it("lists only the authenticated inbox and returns its unread count", async () => {
  expect((await request("GET", "/notifications?recipientId=bob")).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith("alice", null);
  expect(await (await request("GET", "/notifications/unread-count")).json()).toEqual({ unreadCount: 3 });
  expect(mocks.count).toHaveBeenCalledWith("alice");
});
it("validates and passes an opaque cursor", async () => {
  expect((await request("GET", "/notifications?before=invalid")).status).toBe(400);
  expect(mocks.list).not.toHaveBeenCalled();
  const id = "00000000-0000-0000-0000-000000000001";
  expect((await request("GET", `/notifications?before=${encodeURIComponent(`2026-10-09T12:00:00.000Z|${id}`)}`)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith("alice", { time: new Date("2026-10-09T12:00:00.000Z"), id });
});
it("marks only a visible message in the caller's inbox and broadcasts to that caller", async () => {
  expect((await request("PATCH", "/notifications/n/read")).status).toBe(204);
  expect(mocks.read).toHaveBeenCalledWith("alice", "n"); expect(mocks.broadcast).toHaveBeenCalledWith("alice");
  mocks.broadcast.mockClear(); mocks.read.mockResolvedValue(false);
  expect((await request("PATCH", "/notifications/n/read")).status).toBe(404); expect(mocks.broadcast).not.toHaveBeenCalled();
});
it("mark-all is scoped to the authenticated user", async () => {
  expect((await request("POST", "/notifications/read-all")).status).toBe(204);
  expect(mocks.all).toHaveBeenCalledWith("alice"); expect(mocks.broadcast).toHaveBeenCalledWith("alice");
});
