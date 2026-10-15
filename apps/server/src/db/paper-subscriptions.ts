import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "./pool.js";

export const PAPER_SUBSCRIPTIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS paper_subscriptions (
  doc_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (doc_id, user_id),
  KEY idx_paper_subscriptions_user (user_id),
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

export const PAPER_COMMENT_NOTIFICATIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS paper_comment_notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  recipient_id CHAR(36) NOT NULL,
  annotation_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3) NULL,
  UNIQUE KEY uq_paper_comment_recipient (recipient_id, annotation_id),
  KEY idx_paper_comment_inbox (recipient_id, read_at, created_at),
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (annotation_id) REFERENCES human_annotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

export const paperCommentJoins = `JOIN human_annotations comment ON comment.id = pn.annotation_id
 JOIN documents d ON d.id = comment.doc_id
 LEFT JOIN human_annotations root_h ON root_h.id = COALESCE(comment.thread_root_id, comment.id)
   AND (comment.thread_root_kind = 'human' OR comment.thread_root_kind IS NULL) AND root_h.doc_id = comment.doc_id
 LEFT JOIN agent_annotations root_a ON root_a.id = comment.thread_root_id
   AND comment.thread_root_kind = 'agent' AND root_a.doc_id = comment.doc_id`;
export const visiblePaperComment = `pn.recipient_id = ? AND comment.deleted_at IS NULL AND (
 (root_h.id IS NOT NULL AND (root_h.visibility = 'org' OR root_h.author_id = pn.recipient_id)) OR
 (root_a.id IS NOT NULL AND (root_a.visibility = 'org' OR root_a.owner_id = pn.recipient_id)))`;
export const paperCommentInbox = `SELECT pn.id, 'paper_comment' AS kind, comment.author_id AS actor_id,
 actor.display_name AS actor_name, comment.doc_id, d.title AS document_title,
 comment.id AS target_id, 'human' AS target_kind, COALESCE(comment.thread_root_id, comment.id) AS thread_root_id,
 COALESCE(comment.thread_root_kind, 'human') AS thread_root_kind, LEFT(comment.body, 500) AS preview,
 NULL AS parent_preview, pn.created_at, pn.read_at FROM paper_comment_notifications pn ${paperCommentJoins}
 LEFT JOIN users actor ON actor.id = comment.author_id WHERE ${visiblePaperComment}`;

/** Called only by the human-authored comment path, inside the comment transaction. */
export async function notifyPaperSubscribers(conn: PoolConnection, annotationId: string, replyRecipient?: string): Promise<string[]> {
  await conn.query(`INSERT INTO paper_comment_notifications (id, recipient_id, annotation_id)
    SELECT UUID(), s.user_id, comment.id FROM human_annotations comment
    JOIN paper_subscriptions s ON s.doc_id = comment.doc_id JOIN users u ON u.id = s.user_id AND u.status = 'active'
    LEFT JOIN human_annotations h ON h.id = COALESCE(comment.thread_root_id, comment.id)
      AND (comment.thread_root_kind = 'human' OR comment.thread_root_kind IS NULL) AND h.doc_id = comment.doc_id
    LEFT JOIN agent_annotations a ON a.id = comment.thread_root_id AND comment.thread_root_kind = 'agent' AND a.doc_id = comment.doc_id
    WHERE comment.id = ? AND s.user_id <> comment.author_id AND (? IS NULL OR s.user_id <> ?)
    AND ((h.id IS NOT NULL AND (h.visibility = 'org' OR h.author_id = s.user_id))
      OR (a.id IS NOT NULL AND (a.visibility = 'org' OR a.owner_id = s.user_id)))`,
    [annotationId, replyRecipient ?? null, replyRecipient ?? null]);
  const [rows] = await conn.query<RowDataPacket[]>("SELECT recipient_id FROM paper_comment_notifications WHERE annotation_id = ?", [annotationId]);
  return rows.map(row => row.recipient_id as string);
}

export async function isPaperSubscribed(docId: string, userId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT 1 FROM paper_subscriptions WHERE doc_id = ? AND user_id = ?", [docId, userId]);
  return rows.length > 0;
}

export async function findPaperCommentRecipients(annotationId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT recipient_id FROM paper_comment_notifications WHERE annotation_id = ?", [annotationId]);
  return rows.map(row => row.recipient_id as string);
}
