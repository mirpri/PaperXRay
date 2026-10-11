import type { RowDataPacket } from "mysql2";
import { readFile } from "node:fs/promises";
import { pool } from "./pool.js";

try {
  const [columns] = await pool.query<RowDataPacket[]>("SHOW COLUMNS FROM users LIKE 'status'");
  if (!columns.length) {
    // Existing users retain access; only future accounts require approval.
    await pool.query("ALTER TABLE users ADD COLUMN status ENUM('pending', 'active') NOT NULL DEFAULT 'active'");
  }
  await pool.query("ALTER TABLE users ALTER COLUMN status SET DEFAULT 'pending'");
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  const statement = schema.match(/CREATE TABLE membership_notifications \([\s\S]*?;/)?.[0];
  if (!statement) throw new Error("Membership notification schema is missing");
  await pool.query(statement.replace("CREATE TABLE membership_notifications", "CREATE TABLE IF NOT EXISTS membership_notifications"));
  console.log("Membership approval is ready; existing accounts remain active.");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally { await pool.end(); }
