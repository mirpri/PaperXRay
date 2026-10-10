import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query } }));
import { setupComments } from "./setup-comments.js";
beforeEach(() => vi.resetAllMocks());
it("adds only missing reply columns and indexes, preserving existing comments", async () => {
  mocks.query.mockResolvedValueOnce([[{ Field: "id" }, { Field: "parent_id" }]])
    .mockResolvedValueOnce([[{ Key_name: "idx_human_annotations_parent" }]])
    .mockResolvedValueOnce([{}]);
  await setupComments();
  const sql = mocks.query.mock.calls[2][0] as string;
  expect(sql).toContain("ADD COLUMN parent_kind"); expect(sql).toContain("ADD COLUMN thread_root_id");
  expect(sql).toContain("ADD KEY idx_human_annotations_thread");
  expect(sql).not.toMatch(/ADD COLUMN parent_id|ADD KEY idx_human_annotations_parent|DROP|DELETE|UPDATE|INSERT/);
});
it("leaves the current schema untouched on subsequent runs", async () => {
  mocks.query.mockResolvedValueOnce([["parent_id", "parent_kind", "thread_root_id", "thread_root_kind"].map(Field => ({ Field }))])
    .mockResolvedValueOnce([[{ Key_name: "idx_human_annotations_parent" }, { Key_name: "idx_human_annotations_thread" }]]);
  await setupComments(); expect(mocks.query).toHaveBeenCalledTimes(2);
});
