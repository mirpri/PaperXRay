import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CharMap, Node as IrNode } from "@paper-xray/contracts";
import { extractPages } from "../extraction/extract-pages.js";
import { buildDocument } from "../reassembly/build-document.js";
import type { AnchorSnapshot } from "./metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const EVAL_DIR = path.join(REPO_ROOT, "eval");

/** One golden-set entry — see eval/README.md for how to write and label these. */
export interface GoldenFile {
  pdf: string;
  contentHash: string;
  readingOrder: { source: string; snippets: string[] };
  lensGold: {
    labelledBy: string | null;
    annotations: Array<{ lensId: string; evidenceText: string; note?: string }>;
  };
}

export interface LoadedGolden {
  name: string;
  golden: GoldenFile;
  hashMatches: boolean;
  normalizedText: string;
  charMap: CharMap;
  nodes: IrNode[];
}

export async function listGoldenNames(): Promise<string[]> {
  const files = await readdir(path.join(EVAL_DIR, "golden"));
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
}

/** Runs the real extraction + reassembly pipeline on a golden PDF — no database involved. */
export async function loadGolden(name: string): Promise<LoadedGolden> {
  const golden = JSON.parse(await readFile(path.join(EVAL_DIR, "golden", `${name}.json`), "utf8")) as GoldenFile;
  const bytes = await readFile(path.resolve(REPO_ROOT, golden.pdf));
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const pages = await extractPages(new Uint8Array(bytes));
  const { normalizedText, charMap, nodes } = buildDocument(pages, contentHash);
  return { name, golden, hashMatches: contentHash === golden.contentHash, normalizedText, charMap, nodes };
}

export interface AnchorSnapshotFile {
  /** Why these exist: docs/02-decisions.md #2 — a parser upgrade must not move existing annotations. */
  note: string;
  anchors: AnchorSnapshot[];
  /** Reading-order baseline at snapshot time; a later run finding fewer is a regression. */
  readingOrderBaseline: { found: number; inOrder: number };
}

export function snapshotPath(name: string): string {
  return path.join(EVAL_DIR, "snapshots", `${name}.anchors.json`);
}

export async function readSnapshot(name: string): Promise<AnchorSnapshotFile | null> {
  try {
    return JSON.parse(await readFile(snapshotPath(name), "utf8")) as AnchorSnapshotFile;
  } catch {
    return null;
  }
}
