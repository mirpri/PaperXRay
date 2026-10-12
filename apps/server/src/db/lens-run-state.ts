import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { LensRunActivity, LensSpec } from "@paper-xray/contracts";
import { pool } from "./pool.js";

// Also included in schema.sql for fresh installations. Existing installations
// gain this additive table at server startup, without rebuilding the database.
export const LENS_RUN_STATE_SCHEMA = `CREATE TABLE IF NOT EXISTS lens_run_state (
  doc_id CHAR(36) NOT NULL,
  lens_id VARCHAR(64) NOT NULL,
  owner_id CHAR(36) NULL,
  status VARCHAR(16) NOT NULL,
  stage VARCHAR(16) NOT NULL,
  claim_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  produced_count INT NULL,
  submitted_count INT NULL,
  error VARCHAR(1000) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (doc_id, lens_id),
  KEY idx_lens_run_state_queue (status, updated_at),
  CONSTRAINT fk_lens_run_state_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_lens_run_state_lens FOREIGN KEY (lens_id) REFERENCES lenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_lens_run_state_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`;

interface StateRow extends RowDataPacket {
  doc_id: string; lens_id: string; owner_id: string | null;
  status: LensRunActivity["status"]; stage: LensRunActivity["stage"];
  produced_count: number | null; submitted_count: number | null;
  error: string | null; updated_at: Date;
}

export async function listLensRunActivity(docId: string, viewerId: string): Promise<LensRunActivity[]> {
  const [rows] = await pool.query<StateRow[]>(
    `SELECT s.* FROM lens_run_state s JOIN lenses l ON l.id = s.lens_id
     WHERE s.doc_id = ? AND (s.owner_id IS NULL OR s.owner_id = ?) AND l.deleted_at IS NULL`,
    [docId, viewerId],
  );
  return rows.map(row => ({ lensId: row.lens_id, status: row.status, stage: row.stage,
    producedCount: row.produced_count, submittedCount: row.submitted_count,
    error: row.error, updatedAt: row.updated_at.toISOString() }));
}

/** The primary key and atomic upsert serialize concurrent submissions across server processes. */
export async function enqueueLensRun(docId: string, lens: LensSpec): Promise<"queued" | "running"> {
  // A single upsert takes an exclusive row lock, avoiding duplicate-submit
  // races (and shared-lock upgrades from INSERT IGNORE + SELECT FOR UPDATE).
  // status must be assigned LAST: all preceding expressions see the old status.
  await pool.query(
    `INSERT INTO lens_run_state (doc_id, lens_id, owner_id, status, stage)
     VALUES (?, ?, ?, 'queued', 'queued') ON DUPLICATE KEY UPDATE
     stage = IF(status IN ('queued', 'running'), stage, 'queued'),
     claim_token = IF(status IN ('queued', 'running'), claim_token, NULL),
     lease_until = IF(status IN ('queued', 'running'), lease_until, NULL),
     produced_count = IF(status IN ('queued', 'running'), produced_count, NULL),
     submitted_count = IF(status IN ('queued', 'running'), submitted_count, NULL),
     error = IF(status IN ('queued', 'running'), error, NULL),
     updated_at = IF(status IN ('queued', 'running'), updated_at, CURRENT_TIMESTAMP(3)),
     status = IF(status IN ('queued', 'running'), status, 'queued')`,
    [docId, lens.id, lens.ownerId],
  );
  const [rows] = await pool.query<StateRow[]>(
    "SELECT status FROM lens_run_state WHERE doc_id = ? AND lens_id = ?", [docId, lens.id],
  );
  return rows[0]?.status === "running" ? "running" : "queued";
}

export interface ClaimedLensRun { docId: string; lensId: string; token: string }

export async function claimNextLensRun(): Promise<ClaimedLensRun | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<StateRow[]>(
      `SELECT * FROM lens_run_state WHERE status = 'queued' ORDER BY updated_at LIMIT 1 FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) { await conn.commit(); return null; }
    const token = randomUUID();
    await conn.query(
      `UPDATE lens_run_state SET status = 'running', stage = 'model', claim_token = ?,
       lease_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 90 SECOND), updated_at = CURRENT_TIMESTAMP(3)
       WHERE doc_id = ? AND lens_id = ?`, [token, row.doc_id, row.lens_id],
    );
    await conn.commit();
    return { docId: row.doc_id, lensId: row.lens_id, token };
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

export async function renewLensRunLease(job: ClaimedLensRun): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE lens_run_state SET lease_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 90 SECOND)
     WHERE doc_id = ? AND lens_id = ? AND claim_token = ? AND status = 'running'`,
    [job.docId, job.lensId, job.token],
  );
  return result.affectedRows > 0;
}

/** A crashed worker cannot leave a permanent spinner or later commit stale output. */
export async function expireInterruptedLensRuns(): Promise<void> {
  await pool.query(
    `UPDATE lens_run_state SET status = 'failed', stage = 'failed', claim_token = NULL,
     error = 'Lens worker was interrupted. Please run this lens again.', updated_at = CURRENT_TIMESTAMP(3)
     WHERE status = 'running' AND lease_until < CURRENT_TIMESTAMP(3)`,
  );
}
