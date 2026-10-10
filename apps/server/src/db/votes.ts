import type { RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import type { Annotation, AnnotationVotes } from "@paper-xray/contracts";
import { pool } from "./pool.js";

type VoteRow = RowDataPacket & { annotation_id: string; annotation_kind: string; upvotes: number; downvotes: number; my_vote: number };
export async function withVoteSummaries(annotations: Annotation[], docId: string, userId: string): Promise<Annotation[]> {
  if (!annotations.length) return annotations;
  const [rows] = await pool.query<VoteRow[]>(`SELECT annotation_id, annotation_kind,
    SUM(value = 1) AS upvotes, SUM(value = -1) AS downvotes,
    COALESCE(MAX(CASE WHEN voter_id = ? THEN value END), 0) AS my_vote
    FROM annotation_votes WHERE doc_id = ? GROUP BY annotation_kind, annotation_id`, [userId, docId]);
  const summaries = new Map(rows.map(row => [`${row.annotation_kind}:${row.annotation_id}`, {
    upvotes: Number(row.upvotes), downvotes: Number(row.downvotes), myVote: Number(row.my_vote) as -1 | 0 | 1,
  }]));
  return annotations.map(annotation => ({ ...annotation, votes: summaries.get(`${"authorId" in annotation ? "human" : "agent"}:${annotation.id}`) ?? { upvotes: 0, downvotes: 0, myVote: 0 } }));
}

export async function setAnnotationVote(params: {
  docId: string; annotationId: string; kind: "human" | "agent"; voterId: string; value: -1 | 0 | 1; recipientId: string | null;
}): Promise<AnnotationVotes> {
  const { docId, annotationId, kind, voterId, value } = params;
  const recipientId = params.recipientId === voterId ? null : params.recipientId;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize one user's vote changes, including cancellation of a row that may not exist.
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [voterId]);
    const [previous] = await connection.query<RowDataPacket[]>(
      "SELECT id, value FROM annotation_votes WHERE doc_id = ? AND annotation_kind = ? AND annotation_id = ? AND voter_id = ? FOR UPDATE",
      [docId, kind, annotationId, voterId]);
    const oldVote = Number(previous[0]?.value ?? 0);
    if (oldVote !== value) {
      const eventId = uuid();
      if (value === 0) {
        await connection.query("DELETE FROM annotation_votes WHERE id = ?", [previous[0].id]);
      } else if (previous.length) {
        await connection.query("UPDATE annotation_votes SET value = ?, recipient_id = ?, notification_read_at = NULL, updated_at = NOW(3) WHERE id = ?", [value, recipientId, previous[0].id]);
      } else {
        await connection.query(`INSERT INTO annotation_votes (id, doc_id, annotation_id, annotation_kind, voter_id, value, recipient_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [eventId, docId, annotationId, kind, voterId, value, recipientId]);
      }
      if (recipientId) {
        const eventKind = value === 0 ? (oldVote === 1 ? "cancel_upvote" : "cancel_downvote") : (value === 1 ? "upvote" : "downvote");
        await connection.query(`INSERT INTO vote_notifications (id, doc_id, annotation_id, annotation_kind, voter_id, recipient_id, kind)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [eventId, docId, annotationId, kind, voterId, recipientId, eventKind]);
      }
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback(); throw err;
  } finally { connection.release(); }
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(value = 1), 0) AS upvotes, COALESCE(SUM(value = -1), 0) AS downvotes,
    COALESCE(MAX(CASE WHEN voter_id = ? THEN value END), 0) AS my_vote
    FROM annotation_votes WHERE doc_id = ? AND annotation_kind = ? AND annotation_id = ?`, [voterId, docId, kind, annotationId]);
  return { upvotes: Number(rows[0].upvotes), downvotes: Number(rows[0].downvotes), myVote: Number(rows[0].my_vote) as -1 | 0 | 1 };
}

// The current root controls access, including replies to a personal Lens run.
export const voteNotificationJoins = `LEFT JOIN human_annotations target_h ON v.annotation_kind = 'human' AND target_h.id = v.annotation_id AND target_h.doc_id = v.doc_id
 LEFT JOIN agent_annotations target_a ON v.annotation_kind = 'agent' AND target_a.id = v.annotation_id AND target_a.doc_id = v.doc_id
 LEFT JOIN human_annotations root_h ON v.annotation_kind = 'human' AND root_h.id = COALESCE(target_h.thread_root_id, target_h.id)
   AND (target_h.thread_root_kind = 'human' OR target_h.thread_root_kind IS NULL) AND root_h.doc_id = v.doc_id
 LEFT JOIN agent_annotations root_a ON root_a.id = CASE WHEN v.annotation_kind = 'agent' THEN target_a.id ELSE target_h.thread_root_id END
   AND (v.annotation_kind = 'agent' OR target_h.thread_root_kind = 'agent') AND root_a.doc_id = v.doc_id`;
export const visibleVoteNotification = `v.recipient_id = ? AND (
 (target_h.id IS NOT NULL AND target_h.deleted_at IS NULL) OR target_a.id IS NOT NULL) AND (
 (root_h.id IS NOT NULL AND (root_h.visibility = 'org' OR root_h.author_id = v.recipient_id)) OR
 (root_a.id IS NOT NULL AND (root_a.visibility = 'org' OR root_a.owner_id = v.recipient_id)))`;
