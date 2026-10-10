import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query } }));
import { setupVotes } from "./setup-votes.js";
beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue([[]]); });
it("adds history storage and preserves legacy message identity, timestamp, and read state", async () => {
  await setupVotes();
  expect(mocks.query.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS annotation_votes");
  expect(mocks.query.mock.calls[1][0]).toContain("CREATE TABLE IF NOT EXISTS vote_notifications");
  const backfill = mocks.query.mock.calls[2][0];
  expect(backfill).toContain("INSERT IGNORE INTO vote_notifications"); expect(backfill).toContain("notification_read_at, updated_at");
  expect(backfill).not.toMatch(/UPDATE|DELETE|REPLACE/);
});
