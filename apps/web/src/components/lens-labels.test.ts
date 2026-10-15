import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { AgentAnnotation } from "@paper-xray/contracts";
import { annotationLensLabel, readerLensLabels } from "./lens-labels";
import { AnnotationCard } from "./AnnotationCard";
import { FilterChip } from "./FilterChip";
import { ToastProvider } from "../ToastContext";
const annotation: AgentAnnotation = {
 id: "annotation", docId: "doc", agentId: "personal-lens-opaque-id", lensName: "方法论审查", ownerId: "alice", ownerName: "小明",
 agentVersion: "1", runId: "run", anchor: { nodeId: "node", charRange: { start: 0, end: 1 }, contextPrefix: "", contextSuffix: "" },
 evidenceSpan: { start: 0, end: 1 }, comment: "Comment", severity: "info", confidence: 1, visibility: "org", createdAt: "now",
};
it("labels a shared personal Lens with its configured name and owner nickname", () => {
 const labels = readerLensLabels([annotation], [], "bob");
 expect(labels.get(annotation.agentId)).toBe("方法论审查 (小明)");
 const chip = renderToStaticMarkup(createElement(FilterChip, { label: labels.get(annotation.agentId)!, count: 1, ready: true, loading: false, active: true, onClick() {} }));
 const card = renderToStaticMarkup(createElement(ToastProvider, { children: createElement(AnnotationCard, { annotation, normalizedText: "x", active: false, onJumpTo() {}, currentUserId: "bob", repliesByParent: new Map(), onCommentsChanged() {} }) }));
 for (const html of [chip, card]) { expect(html).toContain("方法论审查 (小明)"); expect(html).not.toContain(annotation.agentId); }
});
it("keeps own Lens and organization Lens labels without a foreign owner suffix", () => {
 expect(annotationLensLabel(annotation, "alice")).toBe("方法论审查");
 expect(annotationLensLabel({ ...annotation, ownerId: null, ownerName: undefined }, "bob")).toBe("方法论审查");
});
it("uses the latest own catalog name while retaining names for shared or deleted lenses", () => {
 const labels = readerLensLabels([annotation, { ...annotation, agentId: "own", ownerId: "bob" }], [{ id: "own", name: "Renamed" }], "bob");
 expect(labels.get("own")).toBe("Renamed"); expect(labels.get(annotation.agentId)).toBe("方法论审查 (小明)");
});
it("does not expose an opaque ID if legacy metadata is missing", () => {
 expect(annotationLensLabel({ ...annotation, lensName: undefined, ownerName: undefined }, "bob")).toBe("Lens (Member)");
});
