import type { RowDataPacket } from "mysql2";
import type { ChatModelConfig } from "../lenses/model-client.js";
import { pool } from "./pool.js";
/** Server-only credentials for the organization provider selected by this lens. */
export async function findLensModelConfig(lensId: string): Promise<ChatModelConfig | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT p.base_url, p.api_key, l.model FROM lenses l
    JOIN providers p ON p.id = l.provider_id WHERE l.id = ? AND l.deleted_at IS NULL AND p.deleted_at IS NULL AND p.owner_id IS NULL`, [lensId]);
  const row = rows[0];
  if (!row || typeof row.model !== "string" || !row.model.trim()) return null;
  return { baseUrl: row.base_url, model: row.model, apiKey: row.api_key ?? "" };
}
