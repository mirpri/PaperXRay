import { describe, expect, it } from "vitest";
import { listGoldenNames, loadGolden, readSnapshot } from "./golden.js";
import { checkAnchor, readingOrderScore } from "./metrics.js";

/**
 * Parser regression gate (docs/02-decisions.md #2): stored annotations'
 * charRanges must keep resolving to the same text after any change to
 * extraction or reassembly. If this fails after an intended change, run
 * `pnpm eval --update-snapshots` and plan a migration for stored anchors.
 */
describe("golden set", async () => {
  const names = await listGoldenNames();

  for (const name of names) {
    it(`${name}: anchors are stable and reading order hasn't regressed`, { timeout: 60_000 }, async () => {
      const snapshot = await readSnapshot(name);
      expect(snapshot, `eval/snapshots/${name}.anchors.json missing — run pnpm eval`).not.toBeNull();
      const g = await loadGolden(name);
      expect(g.hashMatches).toBe(true);

      const moved = snapshot!.anchors.filter((a) => checkAnchor(g.normalizedText, a) !== "stable");
      expect(moved.map((a) => a.text)).toEqual([]);

      const ro = readingOrderScore(g.normalizedText, g.golden.readingOrder.snippets);
      expect(ro.found).toBeGreaterThanOrEqual(snapshot!.readingOrderBaseline.found);
      expect(ro.inOrder).toBeGreaterThanOrEqual(snapshot!.readingOrderBaseline.inOrder);
    });
  }
});
