import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { claimNextLensRun, expireInterruptedLensRuns, renewLensRunLease, type ClaimedLensRun } from "../db/lens-run-state.js";
import { findLensById } from "../db/lens-repository.js";
import { findDocumentById, listNodesForDocument, insertAgentAnnotations, recordLensRun } from "../db/repositories.js";
import { verifyAndFilterAgentAnnotations } from "../evidence/apply-verification.js";
import { broadcastAnnotationsChanged, broadcastLensRunsChanged } from "../realtime/socket.js";
import { runOrgLens } from "./run-org-lens.js";

async function execute(job: ClaimedLensRun): Promise<void> {
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    renewLensRunLease(job).then(owned => { if (!owned) controller.abort(); })
      .catch(() => controller.abort());
  }, 30_000);
  heartbeat.unref();
  try {
    const [document, spec] = await Promise.all([findDocumentById(job.docId), findLensById(job.lensId)]);
    if (!document || !spec || spec.executionContext !== "org-server") throw new Error("Document or server lens is no longer available");
    const nodes = await listNodesForDocument(job.docId);
    const candidates = await runOrgLens({ spec, docId: job.docId, normalizedText: document.normalizedText, nodes,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8 * 60_000)]) });
    await pool.query(
      `UPDATE lens_run_state SET stage = 'verifying', updated_at = CURRENT_TIMESTAMP(3)
       WHERE doc_id = ? AND lens_id = ? AND claim_token = ? AND status = 'running'`,
      [job.docId, job.lensId, job.token],
    );
    broadcastLensRunsChanged(job.docId);
    const verified = verifyAndFilterAgentAnnotations({ candidates, normalizedText: document.normalizedText,
      nodes, scope: spec.scope, strictScope: spec.strictScope });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT claim_token FROM lens_run_state WHERE doc_id = ? AND lens_id = ? AND status = 'running' FOR UPDATE`,
        [job.docId, job.lensId],
      );
      if (controller.signal.aborted || rows[0]?.claim_token !== job.token) { await conn.rollback(); return; }
      // Result persistence and terminal status become visible together.
      await insertAgentAnnotations(verified, conn);
      await recordLensRun(job.docId, job.lensId, verified.length, spec.ownerId, conn);
      await conn.query(
        `UPDATE lens_run_state SET status = 'succeeded', stage = 'completed', produced_count = ?,
         submitted_count = ?, claim_token = NULL, lease_until = NULL, updated_at = CURRENT_TIMESTAMP(3)
         WHERE doc_id = ? AND lens_id = ?`, [verified.length, candidates.length, job.docId, job.lensId],
      );
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
    broadcastAnnotationsChanged(job.docId);
  } catch (err) {
    console.error(`Background lens run failed (doc ${job.docId}, lens ${job.lensId}):`, err);
    // Model-client errors contain only HTTP status, never provider bodies/keys.
    const error = err instanceof Error && err.name === "TimeoutError" ? "Model request timed out. Please try again."
      : err instanceof Error && err.message.startsWith("Model call failed:") ? err.message
      : "Lens run failed. Check the server logs or try again.";
    await pool.query(
      `UPDATE lens_run_state SET status = 'failed', stage = 'failed', error = ?, claim_token = NULL,
       lease_until = NULL, updated_at = CURRENT_TIMESTAMP(3)
       WHERE doc_id = ? AND lens_id = ? AND claim_token = ? AND status = 'running'`,
      [error, job.docId, job.lensId, job.token],
    );
  } finally {
    clearInterval(heartbeat);
    broadcastLensRunsChanged(job.docId);
  }
}

/** Bounded DB-backed queue: HTTP requests never wait for model generation. */
export function startLensRunWorker(): () => void {
  let active = 0;
  let polling = false;
  let stopped = false;
  async function tick() {
    if (polling || stopped) return;
    polling = true;
    try {
      await expireInterruptedLensRuns();
      while (!stopped && active < 2) {
        const job = await claimNextLensRun();
        if (!job) break;
        active++;
        broadcastLensRunsChanged(job.docId);
        void execute(job).catch(err => console.error("Lens worker persistence failed:", err))
          .finally(() => { active--; });
      }
    } catch (err) { console.error("Lens worker polling failed:", err); }
    finally { polling = false; }
  }
  const interval = setInterval(() => { void tick(); }, 1000);
  interval.unref();
  void tick();
  return () => { stopped = true; clearInterval(interval); };
}
