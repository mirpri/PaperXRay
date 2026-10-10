import { pathToFileURL } from "node:url";
import type { RowDataPacket } from "mysql2";
import { pool } from "./pool.js";
export async function setupComments(): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>("SHOW COLUMNS FROM human_annotations");
  const definitions: Record<string, string> = { parent_id: "CHAR(36) NULL", parent_kind: "VARCHAR(8) NULL", thread_root_id: "CHAR(36) NULL", thread_root_kind: "VARCHAR(8) NULL" };
  const additions = Object.entries(definitions).filter(([name]) => !columns.some((c) => c.Field === name)).map(([name, definition]) => `ADD COLUMN ${name} ${definition}`);
  const [indexes] = await pool.query<RowDataPacket[]>("SHOW INDEX FROM human_annotations");
  if (!indexes.some((i) => i.Key_name === "idx_human_annotations_parent")) additions.push("ADD KEY idx_human_annotations_parent (parent_kind, parent_id)");
  if (!indexes.some((i) => i.Key_name === "idx_human_annotations_thread")) additions.push("ADD KEY idx_human_annotations_thread (doc_id, thread_root_kind, thread_root_id)");
  if (additions.length) await pool.query(`ALTER TABLE human_annotations ${additions.join(", ")}`);
  console.log("Nested comments schema ready; existing comments retained.");
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupComments().catch((err: unknown) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; }).finally(() => pool.end());
}
