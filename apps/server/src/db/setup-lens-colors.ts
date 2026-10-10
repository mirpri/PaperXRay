import { pathToFileURL } from "node:url";
import type { RowDataPacket } from "mysql2";
import { lensColor, isLensColor } from "@paper-xray/contracts";
import { pool } from "./pool.js";
export async function setupLensColors(): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>("SHOW COLUMNS FROM lenses LIKE 'color'");
  if (!columns.length) await pool.query("ALTER TABLE lenses ADD COLUMN color VARCHAR(7) NULL");
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id, color FROM lenses");
  for (const row of rows) {
    if (!isLensColor(row.color)) await pool.query("UPDATE lenses SET color = ? WHERE id = ? AND (color IS NULL OR color = ?)", [lensColor(row.id), row.id, row.color]);
  }
  console.log("Lens colors ready; existing selections retained.");
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupLensColors().catch((err: unknown) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; }).finally(() => pool.end());
}
