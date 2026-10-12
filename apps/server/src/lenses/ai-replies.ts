import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Annotation, ModelProvider } from "@paper-xray/contracts";
import { pool } from "../db/pool.js";
import { findAgentAnnotationById, findHumanAnnotationById, findDocumentById } from "../db/repositories.js";
import { broadcastAnnotationsChanged, broadcastNotificationsChanged } from "../realtime/socket.js";
import { visibleRoot } from "../discussion/access.js";
import { buildAiReplyMessages } from "./ai-reply-context.js";
import { callChatModel } from "./model-client.js";

export const AI_REPLIES_SCHEMA = `CREATE TABLE IF NOT EXISTS ai_replies (
  reply_id CHAR(36) NOT NULL PRIMARY KEY,
  provider_id VARCHAR(64) NOT NULL,
  provider_name VARCHAR(120) NOT NULL,
  model VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL,
  active_key VARCHAR(160) NULL,
  claim_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  error VARCHAR(1000) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ai_replies_active (active_key),
  KEY idx_ai_replies_queue (status, updated_at),
  CONSTRAINT fk_ai_replies_reply FOREIGN KEY (reply_id) REFERENCES human_annotations(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`;

export async function cancelAiReply(replyId: string): Promise<void> {
  await pool.query(`UPDATE ai_replies SET status = 'failed', error = 'AI reply was deleted',
    active_key = NULL, claim_token = NULL, lease_until = NULL, updated_at = CURRENT_TIMESTAMP(3)
    WHERE reply_id = ? AND status IN ('queued', 'running')`, [replyId]);
}

/** The AI answer is a direct child of the selected annotation/comment. */
export async function createAiReply(params: {
  parent: Annotation; root: Annotation; userId: string; provider: ModelProvider; model: string;
}): Promise<{ replyId: string; reused: boolean }> {
  const { parent, root, userId, provider, model } = params;
  const key = `${userId}:${"authorId" in parent ? "human" : "agent"}:${parent.id}`;
  const conn = await pool.getConnection();
  const replyId = randomUUID();
  try {
    await conn.beginTransaction();
    const parentId = parent.id;
    const parentKind = "authorId" in parent ? "human" : "agent";
    const rootKind = "authorId" in root ? "human" : "agent";
    async function insert(id: string, body: string) {
      await conn.query(
        `INSERT INTO human_annotations (id, doc_id, author_id, anchor, body, visibility, version,
         parent_id, parent_kind, thread_root_id, thread_root_kind) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [id, parent.docId, userId, JSON.stringify(root.anchor), body, root.visibility, parentId, parentKind, root.id, rootKind],
      );
    }
    await insert(replyId, "");
    await conn.query(
      `INSERT INTO ai_replies (reply_id, provider_id, provider_name, model, status, active_key, lease_until)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [replyId, provider.id, provider.name, model, provider.ownerId === null ? "queued" : "running", key,
        provider.ownerId === null ? null : new Date(Date.now() + 9 * 60_000)],
    );
    await conn.commit();
    return { replyId, reused: false };
  } catch (err) {
    await conn.rollback();
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT reply_id FROM ai_replies WHERE active_key = ?", [key]);
      if (rows[0]) return { replyId: rows[0].reply_id, reused: true };
    }
    throw err;
  } finally { conn.release(); }
}

/** Build only the ancestor branch, never unrelated/private threads. */
export async function aiReplyContext(replyId: string) {
  const reply = await findHumanAnnotationById(replyId);
  if (!reply || reply.deletedAt || !reply.authorId || !reply.parentId) throw new Error("AI reply is no longer available");
  const root = await visibleRoot(reply, reply.authorId);
  const document = await findDocumentById(reply.docId);
  if (!root || !document) throw new Error("Discussion is no longer available");
  const branch: Annotation[] = [];
  let id: string | null | undefined = reply.parentId;
  let kind: "human" | "agent" | null | undefined = reply.parentKind;
  const visited = new Set<string>();
  while (id && kind && branch.length < 32) {
    if (visited.has(`${kind}:${id}`)) break;
    visited.add(`${kind}:${id}`);
    const item: Annotation | null = kind === "human" ? await findHumanAnnotationById(id) : await findAgentAnnotationById(id);
    if (!item || item.docId !== reply.docId) break;
    branch.unshift(item);
    if (item.id === root.id) break;
    id = "authorId" in item ? item.parentId : null;
    kind = "authorId" in item ? item.parentKind : null;
  }
  return { reply, messages: buildAiReplyMessages(document, root, branch) };
}

/** Token + row lock prevent an expired worker from overwriting a newer state. */
export async function finishAiReply(replyId: string, token: string | null, body: string, error: string | null): Promise<void> {
  const conn = await pool.getConnection();
  let docId: string | undefined;
  let recipient: string | null = null;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ar.*, h.doc_id, h.deleted_at, h.author_id, h.parent_id, h.parent_kind,
       p.author_id AS recipient_id FROM ai_replies ar JOIN human_annotations h ON h.id = ar.reply_id
       LEFT JOIN human_annotations p ON h.parent_kind = 'human' AND p.id = h.parent_id
       WHERE ar.reply_id = ? FOR UPDATE`, [replyId],
    );
    const row = rows[0];
    if (!row || row.status !== "running" || row.claim_token !== token) { await conn.rollback(); return; }
    docId = row.doc_id;
    const failure = row.deleted_at ? "AI reply was deleted" : error;
    if (!failure) {
      await conn.query("UPDATE human_annotations SET body = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL", [body, replyId]);
      if (row.recipient_id && row.recipient_id !== row.author_id) {
        recipient = row.recipient_id;
        await conn.query("INSERT IGNORE INTO notifications (id, recipient_id, actor_id, doc_id, reply_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)",
          [randomUUID(), recipient, row.author_id, row.doc_id, replyId, row.parent_id]);
      }
    }
    await conn.query(`UPDATE ai_replies SET status = ?, error = ?, active_key = NULL, claim_token = NULL,
      lease_until = NULL, updated_at = CURRENT_TIMESTAMP(3) WHERE reply_id = ?`, [failure ? "failed" : "succeeded", failure, replyId]);
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
  if (docId) broadcastAnnotationsChanged(docId);
  if (recipient) broadcastNotificationsChanged(recipient);
}

async function executeAiReply(replyId: string, token: string, providerId: string, model: string) {
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    pool.query<ResultSetHeader>(`UPDATE ai_replies SET lease_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 90 SECOND)
      WHERE reply_id = ? AND claim_token = ? AND status = 'running'`, [replyId, token])
      .then(([result]) => { if (result.affectedRows === 0) controller.abort(); })
      .catch(() => controller.abort());
  }, 30_000);
  heartbeat.unref();
  try {
    const { messages } = await aiReplyContext(replyId);
    const [providers] = await pool.query<RowDataPacket[]>(
      "SELECT base_url, api_key FROM providers WHERE id = ? AND owner_id IS NULL AND deleted_at IS NULL", [providerId],
    );
    if (!providers[0]) throw new Error("Provider is unavailable");
    const answer = (await callChatModel(messages, { baseUrl: providers[0].base_url, apiKey: providers[0].api_key ?? "", model },
      AbortSignal.any([controller.signal, AbortSignal.timeout(8 * 60_000)]))).trim();
    if (!answer || answer.length > 10000) throw new Error("Model answer must contain 1–10000 characters");
    // Recheck current visibility/deletion before publishing the answer.
    await aiReplyContext(replyId);
    await finishAiReply(replyId, token, answer, null);
  } catch (err) {
    console.error("AI reply failed:", err);
    const message = err instanceof Error && err.message.startsWith("Model call failed: HTTP") ? err.message : "AI reply failed. Check the model settings and try again.";
    await finishAiReply(replyId, token, "", message);
  } finally { clearInterval(heartbeat); }
}

export function startAiReplyWorker(): () => void {
  let active = 0;
  let polling = false;
  let stopped = false;
  let failures = 0;
  let retryAt = 0;
  async function tick() {
    if (polling || stopped || Date.now() < retryAt) return;
    polling = true;
    try {
      const [expired] = await pool.query<RowDataPacket[]>(
        `SELECT ar.reply_id, h.doc_id FROM ai_replies ar JOIN human_annotations h ON h.id = ar.reply_id
         WHERE ar.status = 'running' AND ar.lease_until < CURRENT_TIMESTAMP(3)`,
      );
      await pool.query(`UPDATE ai_replies SET status = 'failed', error = 'AI reply was interrupted. Please try again.',
        active_key = NULL, claim_token = NULL, lease_until = NULL, updated_at = CURRENT_TIMESTAMP(3)
        WHERE status = 'running' AND lease_until < CURRENT_TIMESTAMP(3)`);
      for (const row of expired) broadcastAnnotationsChanged(row.doc_id);
      while (!stopped && active < 2) {
        const conn = await pool.getConnection();
        let row: RowDataPacket | undefined;
        const token = randomUUID();
        try {
          await conn.beginTransaction();
          const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM ai_replies WHERE status = 'queued' ORDER BY updated_at LIMIT 1 FOR UPDATE");
          row = rows[0];
          if (row) await conn.query(`UPDATE ai_replies SET status = 'running', claim_token = ?,
            lease_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 90 SECOND), updated_at = CURRENT_TIMESTAMP(3) WHERE reply_id = ?`, [token, row.reply_id]);
          await conn.commit();
        } catch (err) { await conn.rollback(); throw err; }
        finally { conn.release(); }
        if (!row) break;
        active++;
        void executeAiReply(row.reply_id, token, row.provider_id, row.model)
          .catch(err => console.error("AI reply persistence failed:", err)).finally(() => { active--; });
      }
      failures = 0;
      retryAt = 0;
    } catch (err) {
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
      retryAt = Date.now() + delay;
      console.error(`AI reply queue failed; retrying in ${delay / 1000}s:`, err);
    }
    finally { polling = false; }
  }
  const timer = setInterval(() => { void tick(); }, 1000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
