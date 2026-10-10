import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ uploadsDir: "" }));
vi.mock("../config.js", () => ({ config: settings }));
import { pdfPathForHash, readCharMap, readNormalizedText, writeDocumentContent, writePdf } from "./document-files.js";

const hash = "a".repeat(64);
const map = [{ charStart: 0, charEnd: 3, page: 1, itemIndex: 0, itemCharStart: 0, itemCharEnd: 3 }];

describe("document files", () => {
  beforeEach(async () => { settings.uploadsDir = await mkdtemp(path.join(os.tmpdir(), "paperxray-content-")); });
  afterEach(async () => { await rm(settings.uploadsDir, { recursive: true, force: true }); });

  it("round-trips Unicode text, character offsets and original PDF bytes exactly", async () => {
    const text = "论文𝛼😀\n\nMethods  and results\n";
    await writeDocumentContent(hash, text, map);
    await writePdf(hash, new Uint8Array([37, 80, 68, 70, 0, 255]));
    expect(await readNormalizedText(hash)).toBe(text);
    expect(await readCharMap(hash)).toEqual(map);
    expect([...await readFile(pdfPathForHash(hash))]).toEqual([37, 80, 68, 70, 0, 255]);
    expect((await readdir(settings.uploadsDir)).sort()).toEqual([`${hash}.charmap.json`, `${hash}.pdf`, `${hash}.txt`]);
  });

  it("safely replaces complete content when retrying a write", async () => {
    await writeDocumentContent(hash, "first", map);
    await writeDocumentContent(hash, "second", []);
    expect(await readNormalizedText(hash)).toBe("second");
    expect(await readCharMap(hash)).toEqual([]);
    expect((await readdir(settings.uploadsDir)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("rejects paths outside content-addressed storage and reports missing artifacts", async () => {
    expect(() => pdfPathForHash("../escape")).toThrow("Invalid document content hash");
    await expect(readNormalizedText(hash)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
