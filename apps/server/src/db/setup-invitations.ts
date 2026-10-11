import type { RowDataPacket } from "mysql2";
import { readFile } from "node:fs/promises";
import { pool } from "./pool.js";

try {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  
  // Create invitations table if not exists
  const invitationsStatement = schema.match(/CREATE TABLE invitations \([\s\S]*?;/)?.[0];
  if (!invitationsStatement) throw new Error("Invitations table schema is missing");
  await pool.query(invitationsStatement.replace("CREATE TABLE invitations", "CREATE TABLE IF NOT EXISTS invitations"));
  
  // Create org_settings table if not exists
  const orgSettingsStatement = schema.match(/CREATE TABLE org_settings \([\s\S]*?;/)?.[0];
  if (!orgSettingsStatement) throw new Error("Org settings table schema is missing");
  await pool.query(orgSettingsStatement.replace("CREATE TABLE org_settings", "CREATE TABLE IF NOT EXISTS org_settings"));
  
  // Set default registration mode if not already set
  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT setting_value FROM org_settings WHERE setting_key = 'registration_mode'"
  );
  if (existing.length === 0) {
    await pool.query(
      "INSERT INTO org_settings (setting_key, setting_value) VALUES ('registration_mode', 'approval_required')"
    );
    console.log("Default registration mode set to 'approval_required'");
  }
  
  console.log("Invitations system is ready.");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally { await pool.end(); }
