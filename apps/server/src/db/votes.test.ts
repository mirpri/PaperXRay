import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connection: vi.fn(), change: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query, getConnection: mocks.connection } }));
import { setAnnotationVote, withVoteSummaries } from "./votes.js";
import type { Annotation } from "@paper-xray/contracts";
const params = { docId: "doc", annotationId: "comment", kind: "human" as const, voterId: "bob", value: 1 as const, recipientId: "alice" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connection.mockResolvedValue({ query: mocks.change, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release });
  mocks.change.mockResolvedValue([[]]);
  mocks.query.mockResolvedValue([[{ upvotes: "2", downvotes: "1", my_vote: -1 }]]);
});
function oldVote(value: number) { mocks.change.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ id: "vote", value }]]); }
function events() { return mocks.change.mock.calls.filter(([sql]) => sql.includes("INSERT INTO vote_notifications")); }
it("commits a vote and its notification atomically", async () => {
  expect(await setAnnotationVote(params)).toEqual({ upvotes: 2, downvotes: 1, myVote: -1 });
  expect(events()[0][1]).toEqual([expect.any(String), "doc", "comment", "human", "bob", "alice", "upvote"]);
  expect(mocks.commit).toHaveBeenCalledOnce(); expect(mocks.rollback).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledOnce();
});
it.each([[1, "cancel_upvote"], [-1, "cancel_downvote"]])("cancels vote %s and appends %s without deleting previous messages", async (value, kind) => {
  oldVote(Number(value)); await setAnnotationVote({ ...params, value: 0 });
  expect(mocks.change.mock.calls).toContainEqual(["DELETE FROM annotation_votes WHERE id = ?", ["vote"]]);
  expect(events()[0][1]).toEqual([expect.any(String), "doc", "comment", "human", "bob", "alice", kind]);
  expect(mocks.change.mock.calls.some(([sql]) => /DELETE FROM vote_notifications|UPDATE vote_notifications/.test(sql))).toBe(false);
});
it.each([0, 1, -1] as const)("does not notify again when vote %s is unchanged", async value => {
  if (value) oldVote(value);
  await setAnnotationVote({ ...params, value });
  expect(events()).toHaveLength(0); expect(mocks.change).toHaveBeenCalledTimes(2);
});
it("appends a switch message while retaining the previous event", async () => {
  oldVote(1); await setAnnotationVote({ ...params, value: -1 });
  expect(events()[0][1].at(-1)).toBe("downvote");
  expect(mocks.change.mock.calls.some(([sql]) => /UPDATE vote_notifications/.test(sql))).toBe(false);
});
it("suppresses self notifications, including cancellation", async () => {
  oldVote(1); await setAnnotationVote({ ...params, value: 0, recipientId: "bob" }); expect(events()).toHaveLength(0);
});
it("rolls back cancellation if the cancellation message cannot be saved", async () => {
  oldVote(1); mocks.change.mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error("message failed"));
  await expect(setAnnotationVote({ ...params, value: 0 })).rejects.toThrow("message failed");
  expect(mocks.rollback).toHaveBeenCalledOnce(); expect(mocks.commit).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledOnce();
});
it("attaches separate counts and the viewer's vote without leaking hidden annotations", async () => {
  mocks.query.mockResolvedValueOnce([[{ annotation_id: "same", annotation_kind: "human", upvotes: "3", downvotes: "2", my_vote: -1 }, { annotation_id: "hidden", annotation_kind: "human", upvotes: 8, downvotes: 0, my_vote: 0 }]]);
  const annotations = [{ id: "same", authorId: "alice" }, { id: "same", agentId: "lens" }] as Annotation[];
  const result = await withVoteSummaries(annotations, "doc", "bob");
  expect(result).toHaveLength(2); expect(result[0].votes).toEqual({ upvotes: 3, downvotes: 2, myVote: -1 });
  expect(result[1].votes).toEqual({ upvotes: 0, downvotes: 0, myVote: 0 }); expect(annotations[0].votes).toBeUndefined();
});
