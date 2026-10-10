import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CharMap } from "@paper-xray/contracts";
import { config } from "../config.js";

function documentPath(contentHash: string, suffix: string): string {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Invalid document content hash");
  return path.join(config.uploadsDir, `${contentHash}${suffix}`);
}

export function pdfPathForHash(contentHash: string): string {
  return documentPath(contentHash, ".pdf");
}

/** Publish complete files via rename so readers never see partially written JSON/text. */
async function writeAtomic(target: string, data: string | Uint8Array): Promise<void> {
  await mkdir(config.uploadsDir, { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writePdf(contentHash: string, bytes: Uint8Array): Promise<void> {
  await writeAtomic(pdfPathForHash(contentHash), bytes);
}

export async function writeDocumentContent(contentHash: string, normalizedText: string, charMap: CharMap): Promise<void> {
  await writeAtomic(documentPath(contentHash, ".txt"), normalizedText);
  await writeAtomic(documentPath(contentHash, ".charmap.json"), JSON.stringify(charMap));
}

export async function readNormalizedText(contentHash: string): Promise<string> {
  return readFile(documentPath(contentHash, ".txt"), "utf8");
}

export async function readCharMap(contentHash: string): Promise<CharMap> {
  return JSON.parse(await readFile(documentPath(contentHash, ".charmap.json"), "utf8")) as CharMap;
}
