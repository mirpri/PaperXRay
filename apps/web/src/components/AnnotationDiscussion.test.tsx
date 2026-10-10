import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AgentAnnotation, HumanAnnotation } from "@paper-xray/contracts";
import { AnnotationDiscussion } from "./AnnotationDiscussion";
const comment: HumanAnnotation = {
  id: "comment", docId: "doc", authorId: "alice", authorName: "Alice", body: "Comment", visibility: "org",
  anchor: { nodeId: "node", charRange: { start: 0, end: 4 }, contextPrefix: "", contextSuffix: "" },
  version: 1, createdAt: "now", updatedAt: "now", deletedAt: null, votes: { upvotes: 4, downvotes: 2, myVote: -1 },
};
it("shows both counts and marks the viewer's chosen vote on comments and replies", () => {
  const reply = { ...comment, id: "reply", parentId: "comment", votes: { upvotes: 1, downvotes: 0, myVote: 0 as const } };
  const html = renderToStaticMarkup(<AnnotationDiscussion annotation={comment} byParent={new Map([["human:comment", [reply]]])} userId="bob" onChanged={() => {}} />);
  expect(html).toContain('aria-label="Upvote, 4"'); expect(html).toContain('aria-label="Downvote, 2"');
  expect(html).toContain('title="Remove downvote" aria-pressed="true"');
  expect(html).toContain('aria-label="Upvote, 1"'); expect(html).toContain('aria-label="Downvote, 0"');
});
it("does not offer votes on a deleted comment", () => {
  const html = renderToStaticMarkup(<AnnotationDiscussion annotation={{ ...comment, deletedAt: "now" }} byParent={new Map()} userId="bob" onChanged={() => {}} />);
  expect(html).not.toContain('aria-label="Votes"');
});
it("also shows vote counts for Lens annotations", () => {
  const annotation: AgentAnnotation = { id: "agent", docId: "doc", agentId: "lens", agentVersion: "1", runId: "run", ownerId: "alice", anchor: comment.anchor, evidenceSpan: comment.anchor.charRange, comment: "Lens comment", severity: "info", confidence: 1, visibility: "org", createdAt: "now", votes: { upvotes: 3, downvotes: 1, myVote: 1 } };
  const html = renderToStaticMarkup(<AnnotationDiscussion annotation={annotation} byParent={new Map()} userId="bob" onChanged={() => {}} rootHeader="Lens" />);
  expect(html).toContain('aria-label="Upvote, 3"'); expect(html).toContain('title="Remove upvote" aria-pressed="true"');
});
