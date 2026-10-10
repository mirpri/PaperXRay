import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query } }));
import { findAgentAnnotationById, listAgentAnnotationsForDoc } from "./repositories.js";
const row = { id: "annotation", doc_id: "doc", agent_id: "personal-lens", agent_version: "1", run_id: "run", owner_id: "alice", lens_name: "方法论审查", owner_name: "小明", lens_color: "#168575", anchor: "{}", evidence_span: "{}", comment: "Comment", severity: "info", confidence: 1, visibility: "org", created_at: new Date() };
beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue([[row]]); });
it("returns Lens name and run owner nickname to other viewers of shared annotations", async () => {
 expect((await listAgentAnnotationsForDoc("doc", "bob"))[0]).toMatchObject({ lensName: "方法论审查", ownerName: "小明", ownerId: "alice" });
 const [sql, values] = mocks.query.mock.calls[0];
 expect(sql).toContain("a.visibility = 'org' OR a.owner_id = ?"); expect(values).toEqual(["doc", "bob"]);
 expect(sql).toContain("l.name AS lens_name"); expect(sql).toContain("u.id = a.owner_id");
 expect(sql).not.toMatch(/l\.\*|u\.\*|instruction|api_key|deleted_at/);
});
it("returns the same metadata when resolving a discussion root", async () => {
 expect(await findAgentAnnotationById("annotation")).toMatchObject({ lensName: "方法论审查", ownerName: "小明" });
 expect(mocks.query.mock.calls[0][1]).toEqual(["annotation"]);
});
