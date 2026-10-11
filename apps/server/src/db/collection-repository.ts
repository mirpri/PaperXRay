import type { CollectionMember, CollectionPage, CollectionSummary, CollectionUserOption, DocumentListQuery, DocumentPage } from "@paper-xray/contracts";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import { pool } from "./pool.js";

interface CollectionRow extends RowDataPacket {
  id: string; owner_id: string; owner_name: string; name: string; description: string;
  document_count: number | string; member_count: number | string; is_owner: number | boolean;
  created_at: Date; updated_at: Date;
}

function summary(row: CollectionRow): CollectionSummary {
  return {
    id: row.id, ownerId: row.owner_id, ownerName: row.owner_name, name: row.name, description: row.description,
    isOwner: !!row.is_owner, documentCount: Number(row.document_count), memberCount: Number(row.member_count),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

const collectionProjection = `c.id, c.owner_id, owner.display_name AS owner_name, c.name, c.description,
  (SELECT COUNT(*) FROM collection_documents cd WHERE cd.collection_id = c.id) AS document_count,
  CASE WHEN c.owner_id = ? THEN (SELECT COUNT(*) FROM collection_members cm WHERE cm.collection_id = c.id) ELSE 0 END AS member_count,
  (c.owner_id = ?) AS is_owner, c.created_at, c.updated_at`;

export async function listCollections(userId: string): Promise<CollectionSummary[]> {
  const [rows] = await pool.query<CollectionRow[]>(
    `SELECT ${collectionProjection} FROM collections c JOIN users owner ON owner.id = c.owner_id
     WHERE c.owner_id = ? OR EXISTS (SELECT 1 FROM collection_members mine WHERE mine.collection_id = c.id AND mine.user_id = ?)
     ORDER BY c.updated_at DESC, c.id DESC`, [userId, userId, userId, userId],
  );
  return rows.map(summary);
}

export async function getCollection(collectionId: string, viewerId: string): Promise<CollectionSummary | null> {
  const [rows] = await pool.query<CollectionRow[]>(
    `SELECT ${collectionProjection} FROM collections c JOIN users owner ON owner.id = c.owner_id
     WHERE c.id = ? AND (c.owner_id = ? OR EXISTS
       (SELECT 1 FROM collection_members mine WHERE mine.collection_id = c.id AND mine.user_id = ?)) LIMIT 1`,
    [viewerId, viewerId, collectionId, viewerId, viewerId],
  );
  return rows[0] ? summary(rows[0]) : null;
}

export async function createCollection(ownerId: string, name: string, description: string): Promise<CollectionSummary> {
  const id = uuid();
  await pool.query("INSERT INTO collections (id, owner_id, name, description) VALUES (?, ?, ?, ?)", [id, ownerId, name, description]);
  const created = await getCollection(id, ownerId);
  if (!created) throw new Error("Failed to read back collection");
  return created;
}

const DOCUMENT_ORDER: Record<DocumentListQuery["sort"], string> = {
  newest: "cd.added_at DESC, cd.doc_id DESC", oldest: "cd.added_at ASC, cd.doc_id ASC",
  "title-asc": "d.title ASC, cd.doc_id ASC", "title-desc": "d.title DESC, cd.doc_id DESC",
  "pages-asc": "d.page_count ASC, cd.doc_id ASC", "pages-desc": "d.page_count DESC, cd.doc_id DESC",
};

export async function listCollectionDocuments(collectionId: string, viewerId: string, query: DocumentListQuery): Promise<DocumentPage | null> {
  const where = `cd.collection_id = ? AND (c.owner_id = ? OR EXISTS
    (SELECT 1 FROM collection_members permission WHERE permission.collection_id = c.id AND permission.user_id = ?))`;
  const search = query.search ? " AND d.title LIKE ? ESCAPE '!'" : "";
  const values: unknown[] = [collectionId, viewerId, viewerId];
  if (query.search) values.push(`%${query.search.replace(/[!%_]/g, "!$&")}%`);
  const [counts] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM collection_documents cd JOIN collections c ON c.id = cd.collection_id
     JOIN documents d ON d.id = cd.doc_id WHERE ${where}${search}`, values,
  );
  // The count is zero for both an empty collection and a collection the user cannot access.
  if (Number(counts[0].total) === 0) {
    const [access] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM collections WHERE id = ? AND (owner_id = ? OR EXISTS (SELECT 1 FROM collection_members WHERE collection_id = ? AND user_id = ?)) LIMIT 1",
      [collectionId, viewerId, collectionId, viewerId],
    );
    if (!access[0]) return null;
  }
  const total = Number(counts[0].total);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT d.id, d.content_hash, d.title, d.page_count, d.created_at FROM collection_documents cd
     JOIN collections c ON c.id = cd.collection_id JOIN documents d ON d.id = cd.doc_id
     WHERE ${where}${search} ORDER BY ${DOCUMENT_ORDER[query.sort]} LIMIT ? OFFSET ?`,
    [...values, query.pageSize, (page - 1) * query.pageSize],
  );
  return {
    documents: rows.map(row => ({ id: row.id, contentHash: row.content_hash, title: row.title, pageCount: row.page_count, createdAt: (row.created_at as Date).toISOString() })),
    total, page, pageSize: query.pageSize, totalPages,
  };
}

interface LockedCollection extends RowDataPacket { id: string; owner_id: string }
async function lockCollection(conn: Awaited<ReturnType<typeof pool.getConnection>>, collectionId: string, actorId: string, ownerOnly: boolean): Promise<LockedCollection | null> {
  const permission = ownerOnly ? "c.owner_id = ?" : "(c.owner_id = ? OR EXISTS (SELECT 1 FROM collection_members cm WHERE cm.collection_id = c.id AND cm.user_id = ?))";
  const values = ownerOnly ? [collectionId, actorId] : [collectionId, actorId, actorId];
  const [rows] = await conn.query<LockedCollection[]>(`SELECT c.id, c.owner_id FROM collections c WHERE c.id = ? AND ${permission} FOR UPDATE`, values);
  return rows[0] ?? null;
}

export async function updateCollection(collectionId: string, ownerId: string, name: string, description: string): Promise<"ok" | "not-found" | "duplicate"> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!await lockCollection(conn, collectionId, ownerId, true)) { await conn.rollback(); return "not-found"; }
    await conn.query("UPDATE collections SET name = ?, description = ? WHERE id = ?", [name, description, collectionId]);
    await conn.commit(); return "ok";
  } catch (err) {
    await conn.rollback();
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ER_DUP_ENTRY") return "duplicate";
    throw err;
  } finally { conn.release(); }
}

export async function deleteCollection(collectionId: string, ownerId: string): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!await lockCollection(conn, collectionId, ownerId, true)) { await conn.rollback(); return false; }
    await conn.query("DELETE FROM collections WHERE id = ?", [collectionId]);
    await conn.commit(); return true;
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

export async function addCollectionDocument(collectionId: string, actorId: string, docId: string): Promise<"added" | "exists" | "not-found"> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!await lockCollection(conn, collectionId, actorId, false)) { await conn.rollback(); return "not-found"; }
    const [papers] = await conn.query<RowDataPacket[]>("SELECT id FROM documents WHERE id = ? LIMIT 1", [docId]);
    if (!papers[0]) { await conn.rollback(); return "not-found"; }
    const [existing] = await conn.query<RowDataPacket[]>("SELECT doc_id FROM collection_documents WHERE collection_id = ? AND doc_id = ?", [collectionId, docId]);
    if (existing[0]) { await conn.commit(); return "exists"; }
    await conn.query("INSERT INTO collection_documents (collection_id, doc_id) VALUES (?, ?)", [collectionId, docId]);
    await conn.query("UPDATE collections SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [collectionId]);
    await conn.commit(); return "added";
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

export async function removeCollectionDocument(collectionId: string, actorId: string, docId: string): Promise<"removed" | "unchanged" | "not-found"> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!await lockCollection(conn, collectionId, actorId, false)) { await conn.rollback(); return "not-found"; }
    const [result] = await conn.query<ResultSetHeader>("DELETE FROM collection_documents WHERE collection_id = ? AND doc_id = ?", [collectionId, docId]);
    if (result.affectedRows) await conn.query("UPDATE collections SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [collectionId]);
    await conn.commit(); return result.affectedRows ? "removed" : "unchanged";
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

export async function listCollectionMembers(collectionId: string, ownerId: string): Promise<CollectionMember[] | null> {
  const [collections] = await pool.query<RowDataPacket[]>("SELECT id FROM collections WHERE id = ? AND owner_id = ? LIMIT 1", [collectionId, ownerId]);
  if (!collections[0]) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id AS user_id, u.display_name, u.email, cm.created_at AS shared_at FROM collection_members cm
     JOIN users u ON u.id = cm.user_id WHERE cm.collection_id = ? ORDER BY u.display_name, u.id`, [collectionId],
  );
  return rows.map(row => ({ userId: row.user_id, displayName: row.display_name, email: row.email, sharedAt: (row.shared_at as Date).toISOString() }));
}

export async function listCollectionUserOptions(ownerId: string): Promise<CollectionUserOption[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id, display_name, email FROM users WHERE id <> ? AND status = 'active' ORDER BY display_name, id", [ownerId]);
  return rows.map(row => ({ id: row.id, displayName: row.display_name, email: row.email }));
}

export async function replaceCollectionMembers(collectionId: string, ownerId: string, userIds: string[]): Promise<{ status: "ok"; added: string[] } | "not-found" | "invalid-user"> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!await lockCollection(conn, collectionId, ownerId, true)) { await conn.rollback(); return "not-found"; }
    if (userIds.includes(ownerId)) { await conn.rollback(); return "invalid-user"; }
    if (userIds.length) {
      const [users] = await conn.query<RowDataPacket[]>("SELECT id FROM users WHERE id IN (?) AND status = 'active'", [userIds]);
      if (users.length !== userIds.length) { await conn.rollback(); return "invalid-user"; }
    }
    const [existing] = await conn.query<RowDataPacket[]>("SELECT user_id FROM collection_members WHERE collection_id = ?", [collectionId]);
    const current = new Set(existing.map(row => row.user_id as string));
    const wanted = new Set(userIds);
    const removed = [...current].filter(id => !wanted.has(id));
    const added = [...wanted].filter(id => !current.has(id));
    if (removed.length) await conn.query("DELETE FROM collection_members WHERE collection_id = ? AND user_id IN (?)", [collectionId, removed]);
    if (added.length) await conn.query("INSERT INTO collection_members (collection_id, user_id) VALUES ?", [added.map(id => [collectionId, id])]);
    if (added.length) await conn.query(
      "INSERT INTO collection_notifications (id, recipient_id, actor_id, collection_id, kind) VALUES ?",
      [added.map(userId => [uuid(), userId, ownerId, collectionId, "collection_shared"])],
    );
    if (removed.length || added.length) await conn.query("UPDATE collections SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [collectionId]);
    await conn.commit(); return { status: "ok", added };
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

/** A shared user may revoke only their own membership; collection contents remain untouched. */
export async function leaveCollection(collectionId: string, userId: string): Promise<string | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [collections] = await conn.query<RowDataPacket[]>("SELECT owner_id FROM collections WHERE id = ? FOR UPDATE", [collectionId]);
    if (!collections[0]) { await conn.rollback(); return null; }
    const [result] = await conn.query<ResultSetHeader>("DELETE FROM collection_members WHERE collection_id = ? AND user_id = ?", [collectionId, userId]);
    if (!result.affectedRows) { await conn.rollback(); return null; }
    await conn.query("INSERT INTO collection_notifications (id, recipient_id, actor_id, collection_id, kind) VALUES (?, ?, ?, ?, 'collection_left')",
      [uuid(), collections[0].owner_id, userId, collectionId]);
    await conn.query("UPDATE collections SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [collectionId]);
    await conn.commit(); return String(collections[0].owner_id);
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}
