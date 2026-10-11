import { pathToFileURL } from "node:url";
import type { RowDataPacket } from "mysql2";
import { pool } from "./pool.js";

/** Existing libraries retain their display names; new imports extract titles. */
export async function setupDocumentTitles(): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>("SHOW COLUMNS FROM documents");
  const hasTitle = columns.some(column => column.Field === "title");
  const hasFilename = columns.some(column => column.Field === "original_filename");
  if (!hasTitle && hasFilename) {
    await pool.query("ALTER TABLE documents CHANGE COLUMN original_filename title VARCHAR(500) NULL");
  } else if (!hasTitle) {
    await pool.query("ALTER TABLE documents ADD COLUMN title VARCHAR(500) NULL");
  } else if (hasFilename) {
    // Handle a partially completed manual upgrade without losing saved titles.
    await pool.query("UPDATE documents SET title = original_filename WHERE title IS NULL");
    await pool.query("ALTER TABLE documents DROP COLUMN original_filename");
  }
  console.log("Document titles ready; existing display names retained.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupDocumentTitles().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }).finally(() => pool.end());
}
