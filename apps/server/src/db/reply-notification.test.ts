import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connection: vi.fn(), begin: vi.fn(), insert: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query, getConnection: mocks.connection } }));
import { insertHumanAnnotation } from "./repositories.js";
const params = { docId: "doc", authorId: "bob", anchor: { nodeId: "n", charRange: { start: 0, end: 1 }, contextPrefix: "", contextSuffix: "" }, body: "Reply", visibility: "org" as const, parentId: "parent", parentKind: "human" as const, threadRootId: "root", threadRootKind: "human" as const, notifyRecipientId: "alice" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.connection.mockResolvedValue({ query: mocks.insert, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release });
  mocks.insert.mockResolvedValue([[]]);
  mocks.query.mockResolvedValue([[{ id: "reply", doc_id: "doc", author_id: "bob", anchor: JSON.stringify(params.anchor), body: "Reply", visibility: "org", version: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null }]]);
});
it("commits a reply and its notification together before reading the result", async () => {
  await insertHumanAnnotation(params);
  expect(mocks.begin).toHaveBeenCalledOnce(); expect(mocks.insert).toHaveBeenCalledTimes(4);
  expect(mocks.insert.mock.calls[0][0]).toContain("INSERT INTO human_annotations");
  expect(mocks.insert.mock.calls[1][0]).toContain("INSERT INTO notifications");
  expect(mocks.insert.mock.calls[1][1]).toEqual([expect.any(String), "alice", "bob", "doc", expect.any(String), "parent"]);
  expect(mocks.commit).toHaveBeenCalledOnce(); expect(mocks.rollback).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.commit.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0]);
});
it("rolls back both writes if the notification cannot be stored", async () => {
  mocks.insert.mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error("notification failed"));
  await expect(insertHumanAnnotation(params)).rejects.toThrow("notification failed");
  expect(mocks.rollback).toHaveBeenCalledOnce(); expect(mocks.commit).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledOnce();
});
it("does not create a direct reply notification when replying to oneself, while still notifying subscribers", async () => {
  await insertHumanAnnotation({ ...params, notifyRecipientId: "bob" });
  expect(mocks.connection).toHaveBeenCalledOnce();
  expect(mocks.insert.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications ("))).toBe(false);
  expect(mocks.insert.mock.calls.some(([sql]) => sql.includes("INSERT INTO paper_comment_notifications"))).toBe(true);
});
