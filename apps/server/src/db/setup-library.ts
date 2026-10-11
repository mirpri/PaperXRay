import { pathToFileURL } from "node:url";
import type { RowDataPacket } from "mysql2";
import { pool } from "./pool.js";

const indexes = {
  idx_documents_created: "created_at, id",
  idx_documents_title: "title, id",
  idx_documents_pages: "page_count, id",
};

export async function setupLibraryIndexes(): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>("SHOW INDEX FROM documents");
  const existing = new Set(rows.map(row => row.Key_name));
  for (const [name, columns] of Object.entries(indexes)) {
    if (!existing.has(name)) await pool.query(`ALTER TABLE documents ADD INDEX ${name} (${columns})`);
  }
  console.log("Library sorting indexes ready; existing documents retained.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupLibraryIndexes().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }).finally(() => pool.end());
}
