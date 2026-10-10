import { describe, expect, it } from "vitest";
import type { AgentAnnotation, HumanAnnotation } from "@paper-xray/contracts";
import { canDeleteComment, commentThreads } from "./comment-threads";
const root = { id: "root", authorId: "alice", authorRole: "member", deletedAt: null } as HumanAnnotation;
const reply = { ...root, id: "reply", parentId: "root", parentKind: "human", threadRootId: "root", threadRootKind: "human" } as HumanAnnotation;
describe("comment threads", () => {
  it("keeps replies out of root cards and PDF highlights", () => {
    const result = commentThreads([root, reply]);
    expect(result.roots).toEqual([root]); expect(result.byParent.get("human:root")).toEqual([reply]);
  });
  it("preserves removed ancestors of live nested replies, omits deleted leaves", () => {
    const deletedRoot = { ...root, deletedAt: "now" }; const deletedReply = { ...reply, deletedAt: "now" };
    const nested = { ...reply, id: "nested", parentId: "reply" };
    expect(commentThreads([deletedRoot, deletedReply]).roots).toEqual([]);
    const result = commentThreads([deletedRoot, deletedReply, nested]);
    expect(result.roots).toEqual([deletedRoot]); expect(result.byParent.get("human:root")).toEqual([deletedReply]); expect(result.byParent.get("human:reply")).toEqual([nested]);
  });
  it("attaches replies under Lens annotations", () => {
    const agent = { id: "lens", agentId: "agent" } as AgentAnnotation;
    const child = { ...reply, parentId: "lens", parentKind: "agent", threadRootId: "lens", threadRootKind: "agent" } as HumanAnnotation;
    const result = commentThreads([agent, child]); expect(result.roots).toEqual([agent]); expect(result.byParent.get("agent:lens")).toEqual([child]);
  });
  it("handles deep threads without recursive traversal", () => {
    const replies = Array.from({ length: 10000 }, (_, i) => ({ ...reply, id: `r${i}`, parentId: i ? `r${i - 1}` : "root", deletedAt: i === 9999 ? null : "now" }));
    expect(commentThreads([root, ...replies]).byParent.size).toBe(10000);
  });
  it("shows delete only to author or admin moderating a known non-admin", () => {
    expect(canDeleteComment(root, "alice", "member")).toBe(true);
    expect(canDeleteComment(root, "bob", "member")).toBe(false);
    expect(canDeleteComment(root, "bob", "curator")).toBe(false);
    expect(canDeleteComment(root, "bob", "admin")).toBe(true);
    expect(canDeleteComment({ ...root, authorRole: "admin" }, "bob", "admin")).toBe(false);
    expect(canDeleteComment({ ...root, authorRole: "admin" }, "alice", "admin")).toBe(true);
    expect(canDeleteComment({ ...root, authorRole: undefined }, "bob", "admin")).toBe(false);
    expect(canDeleteComment(root, null, "admin")).toBe(false);
  });
});
