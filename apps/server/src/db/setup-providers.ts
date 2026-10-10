import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { RowDataPacket } from "mysql2";
import { pool } from "./pool.js";

/** One-time conversion of earlier per-lens endpoint settings into reusable providers. */
export async function setupProviders(): Promise<void> {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  const statement = schema.match(/CREATE TABLE providers \([\s\S]*?\) ENGINE=[^;]+;/)?.[0];
  if (!statement) throw new Error("Provider schema not found");
  const conn = await pool.getConnection();
  try {
    await conn.query(statement.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "));
    const [columns] = await conn.query<RowDataPacket[]>("SHOW COLUMNS FROM lenses");
    const additions = [
      !columns.some((c) => c.Field === "provider_id") ? "ADD COLUMN provider_id VARCHAR(64) NULL" : "",
      !columns.some((c) => c.Field === "model") ? "ADD COLUMN model VARCHAR(255) NULL" : "",
    ].filter(Boolean);
    if (additions.length) await conn.query(`ALTER TABLE lenses ${additions.join(", ")}`);
    const [legacy] = await conn.query<RowDataPacket[]>("SHOW TABLES LIKE 'lens_model_configs'");
    if (legacy.length) {
      await conn.beginTransaction();
      try {
        const [rows] = await conn.query<RowDataPacket[]>(`SELECT c.lens_id, c.base_url, c.model, c.api_key, l.provider_id
          FROM lens_model_configs c JOIN lenses l ON l.id = c.lens_id FOR UPDATE`);
        const grouped = new Map<string, { id: string; baseUrl: string; key: string | null; models: Set<string> }>();
        for (const row of rows) {
          if (row.provider_id) continue;
          const key = JSON.stringify([row.base_url, row.api_key]);
          let provider = grouped.get(key);
          if (!provider) {
            provider = { id: `org-provider-${randomUUID()}`, baseUrl: row.base_url, key: row.api_key, models: new Set() };
            grouped.set(key, provider);
          }
          provider.models.add(row.model);
        }
        for (const provider of grouped.values()) {
          await conn.query("INSERT INTO providers (id, name, base_url, models, api_key) VALUES (?, ?, ?, ?, ?)",
            [provider.id, `${new URL(provider.baseUrl).hostname} (${provider.id.slice(-6)})`, provider.baseUrl, JSON.stringify([...provider.models]), provider.key]);
        }
        for (const row of rows) {
          if (row.provider_id) continue;
          const provider = grouped.get(JSON.stringify([row.base_url, row.api_key]))!;
          await conn.query("UPDATE lenses SET provider_id = ?, model = ? WHERE id = ?", [provider.id, row.model, row.lens_id]);
        }
        const [verified] = await conn.query<RowDataPacket[]>(`SELECT c.lens_id FROM lens_model_configs c JOIN lenses l ON l.id = c.lens_id
          LEFT JOIN providers p ON p.id = l.provider_id WHERE p.id IS NULL OR p.base_url <> c.base_url
          OR NOT (p.api_key <=> c.api_key) OR l.model <> c.model`);
        if (verified.length) throw new Error("Legacy configuration verification failed; source table retained");
        await conn.commit();
        console.log(`Converted ${rows.length} lens configuration(s) into reusable providers.`);
      } catch (err) { await conn.rollback(); throw err; }
      await conn.query("DROP TABLE lens_model_configs");
    }
    const [constraints] = await conn.query<RowDataPacket[]>("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lenses' AND CONSTRAINT_NAME = 'fk_lenses_provider'");
    if (!constraints.length) await conn.query("ALTER TABLE lenses ADD CONSTRAINT fk_lenses_provider FOREIGN KEY (provider_id) REFERENCES providers(id)");
    console.log("Provider schema is ready.");
  } finally { conn.release(); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupProviders().catch((err: unknown) => {
    console.error("Provider setup failed:", err instanceof Error ? err.message : String(err)); process.exitCode = 1;
  }).finally(() => pool.end());
}
