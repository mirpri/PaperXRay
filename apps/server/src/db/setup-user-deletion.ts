import { pool } from "./pool.js";
import type { RowDataPacket } from "mysql2";

async function makeNullable(table: string, column: string) {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (rows[0]?.Null !== "YES") await pool.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` CHAR(36) NULL`);
}

async function setDeleteRule(table: string, constraint: string, column: string, rule: "CASCADE" | "SET NULL") {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`, [table, constraint]);
  if (rows[0]?.DELETE_RULE === rule) return;
  if (rows[0]) await pool.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${constraint}\``);
  await pool.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` FOREIGN KEY (\`${column}\`) REFERENCES users(id) ON DELETE ${rule}`);
}

async function ensureColumn(table: string, column: string, definition: string) {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

try {
  await makeNullable("human_annotations", "author_id");
  await setDeleteRule("human_annotations", "fk_human_annotations_author", "author_id", "SET NULL");
  for (const [table, column, rule] of [
    ["notifications", "actor_id", "SET NULL"], ["notifications", "recipient_id", "CASCADE"],
    ["vote_notifications", "voter_id", "SET NULL"], ["vote_notifications", "recipient_id", "CASCADE"],
    ["annotation_votes", "voter_id", "CASCADE"], ["annotation_votes", "recipient_id", "SET NULL"],
    ["collection_notifications", "actor_id", "SET NULL"], ["collection_notifications", "recipient_id", "CASCADE"],
  ] as const) {
    if (rule === "SET NULL") await makeNullable(table, column);
    const fk = `fk_${table}_${column.replace("_id", "")}`;
    await setDeleteRule(table, fk, column, rule);
  }
  await ensureColumn("agent_annotations", "owner_name", "VARCHAR(255) NULL");
  await ensureColumn("agent_annotations", "lens_name", "VARCHAR(120) NULL");
  await ensureColumn("agent_annotations", "lens_color", "VARCHAR(7) NULL");
  await pool.query(`UPDATE agent_annotations a LEFT JOIN lenses l ON l.id = a.agent_id LEFT JOIN users u ON u.id = a.owner_id
    SET a.lens_name = COALESCE(a.lens_name, l.name), a.lens_color = COALESCE(a.lens_color, l.color), a.owner_name = COALESCE(a.owner_name, u.display_name)`);
  console.log("User deletion schema is ready; existing discussion and published Lens results retain attribution snapshots.");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally { await pool.end(); }
