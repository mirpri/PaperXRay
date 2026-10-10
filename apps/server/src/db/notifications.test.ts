import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query } }));
import { countUnreadNotifications, listNotifications, markAllNotificationsRead, markNotificationRead, parseNotificationCursor } from "./notifications.js";
beforeEach(() => vi.resetAllMocks());
it("validates cursor data before SQL", () => {
  for (const raw of [null, 42, "x", "2026-10-09T12:00:00.000Z|x", "9999-99-99T12:00:00.000Z|00000000-0000-0000-0000-000000000001"]) expect(parseNotificationCursor(raw)).toBeNull();
});
it("paginates 30 rows with a stable timestamp and ID cursor", async () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ id: `n${i}`, created_at: new Date("2026-10-09T12:00:00.000Z"), read_at: null }));
  mocks.query.mockResolvedValueOnce([rows]); const page = await listNotifications("alice");
  expect(page.notifications).toHaveLength(30); expect(page.nextCursor).toBe("2026-10-09T12:00:00.000Z|n29");
  const sql = mocks.query.mock.calls[0][0] as string; expect(sql).toContain("reply.deleted_at IS NULL"); expect(sql).toContain("h.author_id = n.recipient_id"); expect(sql).toContain("a.owner_id = n.recipient_id");
  expect(mocks.query.mock.calls[0][1]).toEqual(["alice", "alice"]);
});
it("binds cursor dates and IDs as values", async () => {
  const cursor = { time: new Date(), id: "id" }; mocks.query.mockResolvedValueOnce([[]]);
  await listNotifications("alice", cursor); expect(mocks.query.mock.calls[0][1]).toEqual(["alice", "alice", cursor.time, cursor.time, "id"]);
});
it("scopes counts and read updates to the recipient and current thread visibility", async () => {
  mocks.query.mockResolvedValueOnce([[{ unread: "2" }]]); expect(await countUnreadNotifications("alice")).toBe(2);
  mocks.query.mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([{ affectedRows: 0 }]); expect(await markNotificationRead("alice", "other-inbox")).toBe(false);
  mocks.query.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]); await markAllNotificationsRead("alice");
  for (const [sql, values] of mocks.query.mock.calls) { expect(sql).toMatch(/(?:n|v).recipient_id = \?/); expect(sql).toMatch(/reply.deleted_at IS NULL|target_h.deleted_at IS NULL/); expect(values[0]).toBe("alice"); }
});

it("merges vote events with replies and scopes vote reads to the recipient", async () => {
  mocks.query.mockResolvedValueOnce([[{ id: "vote", kind: "downvote", target_id: "comment", target_kind: "human", preview: "Text", parent_preview: null, created_at: new Date(), read_at: null }]]);
  const page = await listNotifications("alice");
  expect(page.notifications[0]).toMatchObject({ kind: "downvote", targetId: "comment", preview: "Text", parentPreview: null });
  expect(mocks.query.mock.calls[0][0]).toContain("UNION ALL");
  mocks.query.mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);
  expect(await markNotificationRead("alice", "vote")).toBe(true);
  expect(mocks.query.mock.calls.at(-1)).toEqual([expect.stringContaining("v.recipient_id = ?"), ["alice", "vote"]]);
});

it("lists cancellation history independently of the current vote", async () => {
  mocks.query.mockResolvedValueOnce([[{ id: "cancel", kind: "cancel_upvote", target_id: "comment", target_kind: "human", preview: "Text", parent_preview: null, created_at: new Date(), read_at: null }]]);
  const page = await listNotifications("alice"); expect(page.notifications[0].kind).toBe("cancel_upvote");
  const sql = mocks.query.mock.calls[0][0]; expect(sql).toContain("FROM vote_notifications v"); expect(sql).not.toContain("FROM annotation_votes v");
});
