import { beforeEach, expect, it, vi } from "vitest";
import { lensColor } from "@paper-xray/contracts";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query } }));
import { setupLensColors } from "./setup-lens-colors.js";
beforeEach(() => vi.resetAllMocks());
it("adds the missing column, fills legacy colors, and preserves configured colors", async () => {
  mocks.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{}]).mockResolvedValueOnce([[{ id: "old", color: null }, { id: "selected", color: "#168575" }]]).mockResolvedValueOnce([{}]);
  await setupLensColors();
  expect(mocks.query.mock.calls[1][0]).toBe("ALTER TABLE lenses ADD COLUMN color VARCHAR(7) NULL");
  expect(mocks.query.mock.calls[3][1]).toEqual([lensColor("old"), "old", null]);
  expect(mocks.query).toHaveBeenCalledTimes(4);
});
it("does not alter data or schema when all colors are already configured", async () => {
  mocks.query.mockResolvedValueOnce([[{ Field: "color" }]]).mockResolvedValueOnce([[{ id: "selected", color: "#168575" }]]);
  await setupLensColors(); expect(mocks.query).toHaveBeenCalledTimes(2);
});
