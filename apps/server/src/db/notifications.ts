import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { AnnotationNotification, NotificationPage } from "@paper-xray/contracts";
import { pool } from "./pool.js";
import { voteNotificationJoins, visibleVoteNotification } from "./votes.js";

// Access follows the current thread root; hiding a Lens run also hides its notifications.
const joins = `FROM notifications n
 JOIN human_annotations reply ON reply.id = n.reply_id AND reply.doc_id = n.doc_id
 JOIN human_annotations parent ON parent.id = n.parent_id AND parent.doc_id = n.doc_id
 JOIN users actor ON actor.id = n.actor_id
 JOIN documents d ON d.id = n.doc_id
 LEFT JOIN human_annotations h ON reply.thread_root_kind = 'human' AND h.id = reply.thread_root_id AND h.doc_id = n.doc_id
 LEFT JOIN agent_annotations a ON reply.thread_root_kind = 'agent' AND a.id = reply.thread_root_id AND a.doc_id = n.doc_id`;
const visible = `n.recipient_id = ? AND reply.deleted_at IS NULL AND (
 (h.id IS NOT NULL AND (h.visibility = 'org' OR h.author_id = n.recipient_id)) OR
 (a.id IS NOT NULL AND (a.visibility = 'org' OR a.owner_id = n.recipient_id)))`;
// Replies and immutable vote events share one cursor and unread count.
const inbox = `SELECT n.id, 'reply' AS kind, n.actor_id, actor.display_name AS actor_name, n.doc_id,
 d.original_filename AS document_title, n.reply_id AS target_id, 'human' AS target_kind,
 reply.thread_root_id, reply.thread_root_kind, LEFT(reply.body, 500) AS preview,
 CASE WHEN parent.deleted_at IS NULL THEN LEFT(parent.body, 300) ELSE '' END AS parent_preview,
 n.created_at, n.read_at ${joins} WHERE ${visible}
 UNION ALL
 SELECT v.id, v.kind, v.voter_id AS actor_id,
 actor.display_name AS actor_name, v.doc_id, d.original_filename AS document_title, v.annotation_id AS target_id,
 v.annotation_kind AS target_kind, COALESCE(root_h.id, root_a.id) AS thread_root_id,
 CASE WHEN root_h.id IS NOT NULL THEN 'human' ELSE 'agent' END AS thread_root_kind,
 LEFT(COALESCE(target_h.body, target_a.comment), 500) AS preview, NULL AS parent_preview,
 v.created_at, v.read_at FROM vote_notifications v ${voteNotificationJoins}
 JOIN users actor ON actor.id = v.voter_id JOIN documents d ON d.id = v.doc_id WHERE ${visibleVoteNotification}`;
interface NotificationRow extends RowDataPacket {
  id: string; kind: AnnotationNotification["kind"]; actor_id: string; actor_name: string; doc_id: string; document_title: string | null;
  target_id: string; target_kind: "human" | "agent"; thread_root_id: string; thread_root_kind: "human" | "agent";
  preview: string; parent_preview: string | null; created_at: Date; read_at: Date | null;
}
export function parseNotificationCursor(raw: unknown): { time: Date; id: string } | null {
  if (typeof raw !== "string") return null;
  const [time, id, extra] = raw.split("|");
  if (extra !== undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time ?? "") || !/^[a-f0-9-]{36}$/i.test(id ?? "")) return null;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? { time: date, id } : null;
}
export async function listNotifications(userId: string, cursor?: { time: Date; id: string } | null): Promise<NotificationPage> {
  const values: unknown[] = [userId, userId];
  let before = "";
  if (cursor) { before = " WHERE (created_at < ? OR (created_at = ? AND id < ?))"; values.push(cursor.time, cursor.time, cursor.id); }
  const [rows] = await pool.query<NotificationRow[]>(`SELECT * FROM (${inbox}) inbox${before} ORDER BY created_at DESC, id DESC LIMIT 31`, values);
  const notifications: AnnotationNotification[] = rows.slice(0, 30).map(r => ({
    id: r.id, kind: r.kind, actorId: r.actor_id, actorName: r.actor_name, docId: r.doc_id, documentTitle: r.document_title,
    targetId: r.target_id, targetKind: r.target_kind, threadRootId: r.thread_root_id, threadRootKind: r.thread_root_kind,
    preview: r.preview, parentPreview: r.parent_preview, createdAt: r.created_at.toISOString(), readAt: r.read_at?.toISOString() ?? null,
  }));
  const last = notifications.at(-1);
  return { notifications, nextCursor: rows.length > 30 && last ? `${last.createdAt}|${last.id}` : null };
}
export async function countUnreadNotifications(userId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) ${joins} WHERE ${visible} AND n.read_at IS NULL) +
    (SELECT COUNT(*) FROM vote_notifications v ${voteNotificationJoins} WHERE ${visibleVoteNotification} AND v.read_at IS NULL) AS unread`, [userId, userId]);
  return Number(rows[0].unread);
}
export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(`UPDATE notifications n
    JOIN human_annotations reply ON reply.id = n.reply_id AND reply.doc_id = n.doc_id
    LEFT JOIN human_annotations h ON reply.thread_root_kind = 'human' AND h.id = reply.thread_root_id AND h.doc_id = n.doc_id
    LEFT JOIN agent_annotations a ON reply.thread_root_kind = 'agent' AND a.id = reply.thread_root_id AND a.doc_id = n.doc_id
    SET n.read_at = COALESCE(n.read_at, NOW(3)) WHERE ${visible} AND n.id = ?`, [userId, id]);
  if (result.affectedRows > 0) return true;
  const [voteResult] = await pool.query<ResultSetHeader>(`UPDATE vote_notifications v
    ${voteNotificationJoins}
    SET v.read_at = COALESCE(v.read_at, NOW(3)) WHERE ${visibleVoteNotification} AND v.id = ?`, [userId, id]);
  return voteResult.affectedRows > 0;
}
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await pool.query(`UPDATE notifications n
    JOIN human_annotations reply ON reply.id = n.reply_id AND reply.doc_id = n.doc_id
    LEFT JOIN human_annotations h ON reply.thread_root_kind = 'human' AND h.id = reply.thread_root_id AND h.doc_id = n.doc_id
    LEFT JOIN agent_annotations a ON reply.thread_root_kind = 'agent' AND a.id = reply.thread_root_id AND a.doc_id = n.doc_id
    SET n.read_at = NOW(3) WHERE ${visible} AND n.read_at IS NULL`, [userId]);
  await pool.query(`UPDATE vote_notifications v
    ${voteNotificationJoins}
    SET v.read_at = NOW(3) WHERE ${visibleVoteNotification} AND v.read_at IS NULL`, [userId]);
}
export async function findNotificationRecipient(replyId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT recipient_id FROM notifications WHERE reply_id = ? LIMIT 1", [replyId]);
  return rows[0]?.recipient_id ?? null;
}
