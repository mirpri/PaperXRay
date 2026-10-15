import type { RowDataPacket } from "mysql2";
import { pool } from "./pool.js";

/** Add the optional color field without rebuilding an existing database. */
export async function ensureHumanAnnotationColors(): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>("SHOW COLUMNS FROM human_annotations LIKE 'color'");
  if (columns.length) return;
  try {
    await pool.query("ALTER TABLE human_annotations ADD COLUMN color VARCHAR(7) NULL");
  } catch (error) {
    // Another server may have added the column after the existence check.
    if ((error as { code?: string }).code !== "ER_DUP_FIELDNAME") throw error;
  }
}
