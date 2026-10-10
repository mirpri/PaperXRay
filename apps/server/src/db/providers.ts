import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { ModelProvider, ProviderDraft } from "@paper-xray/contracts";
import { pool } from "./pool.js";
import { bumpVersion } from "./lens-repository.js";
const columns = "id, owner_id, name, base_url, models, (api_key IS NOT NULL AND api_key <> '') AS has_api_key";
function toProvider(row: RowDataPacket): ModelProvider {
  return { id: row.id, ownerId: row.owner_id, name: row.name, baseUrl: row.base_url, models: JSON.parse(row.models), hasApiKey: Boolean(row.has_api_key) };
}
export async function listProviders(userId: string): Promise<ModelProvider[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${columns} FROM providers WHERE deleted_at IS NULL AND (owner_id IS NULL OR owner_id = ?) ORDER BY owner_id IS NOT NULL, name`, [userId]);
  return rows.map(toProvider);
}
export async function findProvider(id: string): Promise<ModelProvider | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${columns} FROM providers WHERE id = ? AND deleted_at IS NULL`, [id]);
  return rows[0] ? toProvider(rows[0]) : null;
}
export class ProviderConflict extends Error {}
export async function saveProvider(id: string | null, ownerId: string | null, draft: ProviderDraft): Promise<ModelProvider> {
  const providerId = id ?? `${ownerId === null ? "org" : "personal"}-provider-${randomUUID()}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<RowDataPacket[]>("SELECT api_key FROM providers WHERE id = ? FOR UPDATE", [providerId]);
    const [lenses] = await conn.query<RowDataPacket[]>("SELECT id, model, version FROM lenses WHERE provider_id = ? AND deleted_at IS NULL FOR UPDATE", [providerId]);
    const key = ownerId !== null ? null : draft.apiKey === undefined ? existing[0]?.api_key ?? null : draft.apiKey;
    await conn.query(`INSERT INTO providers (id, owner_id, name, base_url, models, api_key) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE name = VALUES(name), base_url = VALUES(base_url), models = VALUES(models), api_key = VALUES(api_key)`,
      [providerId, ownerId, draft.name, draft.baseUrl, JSON.stringify(draft.models), key]);
    for (const lens of lenses) await conn.query("UPDATE lenses SET version = ? WHERE id = ?", [bumpVersion(lens.version), lens.id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err instanceof ProviderConflict) throw err;
    throw new Error("Failed to save provider settings");
  } finally { conn.release(); }
  const provider = await findProvider(providerId);
  if (!provider) throw new Error("Provider could not be read after saving");
  return provider;
}
export async function deleteProvider(id: string): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SELECT id FROM providers WHERE id = ? FOR UPDATE", [id]);
    const [used] = await conn.query<RowDataPacket[]>("SELECT id FROM lenses WHERE provider_id = ? AND deleted_at IS NULL LIMIT 1", [id]);
    if (used.length) throw new ProviderConflict("This provider is used by a lens. Choose another provider for that lens before deleting it.");
    await conn.query("UPDATE providers SET deleted_at = CURRENT_TIMESTAMP(3), api_key = NULL WHERE id = ?", [id]);
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}
