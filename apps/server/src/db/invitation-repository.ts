import { randomBytes } from "crypto";
import { pool } from "./pool.js";
import { v4 as uuid } from "uuid";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

export interface Invitation {
  id: string;
  code: string;
  created_by: string;
  email: string | null;
  role: string;
  used_at: Date | null;
  used_by: string | null;
  used_by_name?: string | null;
  expires_at: Date | null;
  created_at: Date;
}

export type RegistrationMode = "invite_only" | "approval_required" | "open";

interface InvitationRow extends RowDataPacket, Invitation {}

interface OrgSettingRow extends RowDataPacket {
  setting_key: string;
  setting_value: string;
}

function generateInvitationCode(): string {
  return randomBytes(32).toString("base64url");
}

export async function createInvitation(
  createdBy: string,
  email: string | null,
  role: string,
  expiresAt: Date | null
): Promise<Invitation> {
  const id = uuid();
  const code = generateInvitationCode();
  
  await pool.query(
    `INSERT INTO invitations (id, code, created_by, email, role, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, code, createdBy, email, role, expiresAt]
  );

  return {
    id,
    code,
    created_by: createdBy,
    email,
    role,
    used_at: null,
    used_by: null,
    expires_at: expiresAt,
    created_at: new Date(),
  };
}

export async function listInvitations(): Promise<Invitation[]> {
  const [rows] = await pool.query<InvitationRow[]>(
    `SELECT i.*, u.display_name as used_by_name 
     FROM invitations i 
     LEFT JOIN users u ON i.used_by = u.id 
     ORDER BY i.created_at DESC`
  );
  return rows.map(row => ({
    id: row.id,
    code: row.code,
    created_by: row.created_by,
    email: row.email,
    role: row.role,
    used_at: row.used_at,
    used_by: row.used_by,
    used_by_name: row.used_by_name,
    expires_at: row.expires_at,
    created_at: row.created_at,
  }));
}

export async function getInvitationByCode(code: string): Promise<Invitation | null> {
  const [rows] = await pool.query<InvitationRow[]>(
    `SELECT * FROM invitations WHERE code = ?`,
    [code]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: row.id,
    code: row.code,
    created_by: row.created_by,
    email: row.email,
    role: row.role,
    used_at: row.used_at,
    used_by: row.used_by,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export async function markInvitationUsed(code: string, usedBy: string): Promise<void> {
  await pool.query(
    `UPDATE invitations SET used_at = NOW(3), used_by = ? WHERE code = ?`,
    [usedBy, code]
  );
}

export async function deleteInvitation(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM invitations WHERE id = ?`,
    [id]
  );
  return result.affectedRows > 0;
}

export async function getRegistrationMode(): Promise<RegistrationMode> {
  const [rows] = await pool.query<OrgSettingRow[]>(
    `SELECT setting_value FROM org_settings WHERE setting_key = 'registration_mode'`
  );
  
  if (rows.length === 0) {
    return "approval_required"; // default
  }
  
  const value = rows[0].setting_value;
  if (value === "invite_only" || value === "approval_required" || value === "open") {
    return value;
  }
  
  return "approval_required";
}

export async function setRegistrationMode(mode: RegistrationMode): Promise<void> {
  await pool.query(
    `INSERT INTO org_settings (setting_key, setting_value)
     VALUES ('registration_mode', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [mode]
  );
}
