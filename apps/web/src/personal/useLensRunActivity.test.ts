import { describe, expect, it, vi } from "vitest";
import { createLensRunActivity } from "./useLensRunActivity";
function deferred() {
  let resolve!: () => void; let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("concurrent Lens activity", () => {
  it("keeps both runs pending and clears only the run that finishes, in either order", async () => {
    for (const first of ["A", "B"]) {
      let pending: ReadonlySet<string> = new Set();
      const track = createLensRunActivity(keys => { pending = keys; });
      const a = deferred(), b = deferred();
      const runA = track("doc:A", () => a.promise), runB = track("doc:B", () => b.promise);
      expect([...pending]).toEqual(["doc:A", "doc:B"]);
      if (first === "A") { a.resolve(); await runA; } else { b.resolve(); await runB; }
      expect([...pending]).toEqual([first === "A" ? "doc:B" : "doc:A"]);
      a.resolve(); b.resolve(); await Promise.all([runA, runB]); expect(pending.size).toBe(0);
    }
  });
  it("rejects duplicate clicks before any asynchronous provider preparation finishes", async () => {
    const track = createLensRunActivity(() => {}); const preparation = deferred(); const model = vi.fn();
    const work = vi.fn(async () => { await preparation.promise; model(); });
    const first = track("doc:A", work); await track("doc:A", work);
    expect(work).toHaveBeenCalledTimes(1); expect(model).not.toHaveBeenCalled();
    preparation.resolve(); await first; expect(model).toHaveBeenCalledTimes(1);
    await track("doc:A", work); expect(work).toHaveBeenCalledTimes(2);
  });
  it("clears a failed run without clearing another pending run, and permits retry", async () => {
    let pending: ReadonlySet<string> = new Set(); const track = createLensRunActivity(keys => { pending = keys; });
    const a = deferred(), b = deferred(); const runA = track("doc:A", () => a.promise), runB = track("doc:B", () => b.promise);
    const failure = expect(runA).rejects.toThrow("failed"); a.reject(new Error("failed")); await failure;
    expect([...pending]).toEqual(["doc:B"]);
    await track("doc:A", async () => {}); expect([...pending]).toEqual(["doc:B"]);
    b.resolve(); await runB; expect(pending.size).toBe(0);
  });
  it("tracks the same lens separately for different documents", async () => {
    let pending: ReadonlySet<string> = new Set(); const track = createLensRunActivity(keys => { pending = keys; });
    const a = deferred(), b = deferred(); const runA = track("doc-1:A", () => a.promise), runB = track("doc-2:A", () => b.promise);
    a.resolve(); await runA; expect([...pending]).toEqual(["doc-2:A"]);
    b.resolve(); await runB;
  });
});
