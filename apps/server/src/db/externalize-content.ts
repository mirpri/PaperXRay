import { pathToFileURL } from "node:url";
import type { CharMap } from "@paper-xray/contracts";
import type { RowDataPacket } from "mysql2";
import { pool } from "./pool.js";
import { readCharMap, readNormalizedText, writeDocumentContent } from "../storage/document-files.js";

interface LegacyContentRow extends RowDataPacket {
  id: string;
  content_hash: string;
  normalized_text: string;
  char_map: string | null;
}

/** One-time conversion for existing installations; not a versioned migration runner. */
export async function externalizeDocumentContent(): Promise<void> {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [columns] = await conn.query<RowDataPacket[]>("SHOW COLUMNS FROM documents");
    const legacyColumns = ["normalized_text", "char_map"].filter((name) => columns.some((c) => c.Field === name));
    if (legacyColumns.length === 0) {
      console.log("Document content already uses file storage.");
      return;
    }
    if (legacyColumns.length !== 2) throw new Error("Unexpected partial legacy schema; no columns have been removed.");

    // Stop the application before running this tool. The write lock also prevents
    // other connections changing rows while files are exported and verified.
    await conn.query("SET SESSION lock_wait_timeout = 10");
    await conn.query("LOCK TABLES documents WRITE");
    locked = true;
    let lastId = "";
    let exported = 0;
    for (;;) {
      const [rows] = await conn.query<LegacyContentRow[]>(
        "SELECT id, content_hash, normalized_text, char_map FROM documents WHERE id > ? ORDER BY id LIMIT 25",
        [lastId],
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        const charMap = row.char_map === null ? [] : JSON.parse(row.char_map) as CharMap;
        if (!Array.isArray(charMap)) throw new Error(`Invalid CharMap for document ${row.id}`);
        await writeDocumentContent(row.content_hash, row.normalized_text, charMap);
        // Never drop source columns unless every exported file can be read back intact.
        if (await readNormalizedText(row.content_hash) !== row.normalized_text ||
            JSON.stringify(await readCharMap(row.content_hash)) !== JSON.stringify(charMap)) {
          throw new Error(`File verification failed for document ${row.id}; source columns retained.`);
        }
        exported++;
      }
      lastId = rows[rows.length - 1].id;
    }
    await conn.query("ALTER TABLE documents DROP COLUMN normalized_text, DROP COLUMN char_map");
    console.log(`Exported and verified ${exported} document(s); removed database text and CharMap columns.`);
  } finally {
    try {
      if (locked) await conn.query("UNLOCK TABLES");
    } finally {
      conn.release();
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  externalizeDocumentContent()
    .catch((err: unknown) => {
      console.error("Document content export failed:", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
