import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { v4 as uuid } from "uuid";
import type {
  AgentAnnotation,
  Anchor,
  CharMap,
  Document,
  DocumentSummary,
  DocumentListQuery,
  DocumentPage,
  HumanAnnotation,
  Node as IrNode,
  Role,
  SsoConfigPublic,
  User,
  Visibility,
} from "@paper-xray/contracts";
import { lensColor, DEFAULT_DOCUMENT_QUERY } from "@paper-xray/contracts";
import { pool } from "./pool.js";
import { readCharMap, readNormalizedText, writeDocumentContent } from "../storage/document-files.js";

interface DocumentRow extends RowDataPacket {
  id: string;
  content_hash: string;
  title: string | null;
  page_count: number;
  created_at: Date;
}

async function toDocument(row: DocumentRow): Promise<Document> {
  return {
    id: row.id,
    contentHash: row.content_hash,
    title: row.title,
    pageCount: row.page_count,
    normalizedText: await readNormalizedText(row.content_hash),
    createdAt: row.created_at.toISOString(),
  };
}

function toDocumentSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    contentHash: row.content_hash,
    title: row.title,
    pageCount: row.page_count,
    createdAt: row.created_at.toISOString(),
  };
}

const DOCUMENT_ORDER: Record<DocumentListQuery["sort"], string> = {
  newest: "created_at DESC, id DESC", oldest: "created_at ASC, id ASC",
  "title-asc": "title ASC, id ASC", "title-desc": "title DESC, id DESC",
  "pages-asc": "page_count ASC, id ASC", "pages-desc": "page_count DESC, id DESC",
};

/** Search and paginate metadata in SQL; never load every PDF's parsed content. */
export async function listDocuments(query: DocumentListQuery = DEFAULT_DOCUMENT_QUERY): Promise<DocumentPage> {
  // Treat LIKE wildcard characters as literal search text, using an explicit escape.
  const where = query.search ? " WHERE title LIKE ? ESCAPE '!'" : "";
  const values = query.search ? [`%${query.search.replace(/[!%_]/g, "!$&")}%`] : [];
  const [counts] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM documents${where}`, values);
  const total = Number(counts[0].total);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const [rows] = await pool.query<DocumentRow[]>(
    `SELECT id, content_hash, title, page_count, created_at FROM documents${where} ORDER BY ${DOCUMENT_ORDER[query.sort]} LIMIT ? OFFSET ?`,
    [...values, query.pageSize, (page - 1) * query.pageSize],
  );
  return { documents: rows.map(toDocumentSummary), total, page, pageSize: query.pageSize, totalPages };
}

/** Updating a display title never reads or changes PDF/text artifacts. */
export async function updateDocumentTitle(id: string, title: string): Promise<DocumentSummary | null> {
  await pool.query("UPDATE documents SET title = ? WHERE id = ?", [title, id]);
  // Read even when affectedRows is zero: saving the same title is valid.
  const [rows] = await pool.query<DocumentRow[]>(
    "SELECT id, content_hash, title, page_count, created_at FROM documents WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ? toDocumentSummary(rows[0]) : null;
}

export async function findDocumentByContentHash(
  contentHash: string,
): Promise<Document | null> {
  const [rows] = await pool.query<DocumentRow[]>(
    "SELECT id, content_hash, title, page_count, created_at FROM documents WHERE content_hash = ? LIMIT 1",
    [contentHash],
  );
  return rows[0] ? toDocument(rows[0]) : null;
}

export async function findDocumentById(id: string): Promise<Document | null> {
  const [rows] = await pool.query<DocumentRow[]>(
    "SELECT id, content_hash, title, page_count, created_at FROM documents WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ? toDocument(rows[0]) : null;
}

/** Status polling and enqueue checks must not reload the document's full text. */
export async function documentExists(id: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM documents WHERE id = ? LIMIT 1", [id]);
  return rows.length > 0;
}

export async function deleteDocument(id: string): Promise<{ contentHash: string } | null> {
  const doc = await findDocumentById(id);
  if (!doc) return null;
  
  await pool.query("DELETE FROM documents WHERE id = ?", [id]);
  return { contentHash: doc.contentHash };
}

interface NodeRow extends RowDataPacket {
  id: string;
  doc_id: string;
  type: IrNode["type"];
  parent_id: string | null;
  order: number;
  char_start: number;
  char_end: number;
  page_hint: number;
}

function toNode(row: NodeRow): IrNode {
  return {
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    order: row.order,
    charRange: { start: row.char_start, end: row.char_end },
    pageHint: row.page_hint,
  };
}

/** Needed to re-run lenses on demand (POST /documents/:id/lenses/run) — a lens needs the same Node[] it got at upload time to anchor evidence to. */
export async function listNodesForDocument(docId: string): Promise<IrNode[]> {
  const [rows] = await pool.query<NodeRow[]>(
    "SELECT id, doc_id, type, parent_id, `order`, char_start, char_end, page_hint FROM nodes WHERE doc_id = ? ORDER BY `order` ASC",
    [docId],
  );
  return rows.map(toNode);
}

export interface LensRun {
  lensId: string;
  producedCount: number;
  ranAt: string;
}

interface LensRunRow extends RowDataPacket {
  lens_id: string;
  produced_count: number;
  ran_at: Date;
}

/**
 * A lens "has run" the moment this row exists, independent of
 * producedCount — a lens that ran and found nothing is a different fact
 * from one that was never triggered (the frontend's filter chips need to
 * tell those apart, see apps/web/src/pages/ReaderPage.tsx).
 */
export async function recordLensRun(
  docId: string,
  lensId: string,
  producedCount: number,
  ownerId: string | null = null,
  transaction?: PoolConnection,
): Promise<void> {
  await (transaction ?? pool).query(
    `INSERT INTO lens_runs (doc_id, lens_id, owner_id, produced_count)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE produced_count = VALUES(produced_count), ran_at = CURRENT_TIMESTAMP(3)`,
    [docId, lensId, ownerId, producedCount],
  );
}

/** Org-lens runs plus the viewer's own personal-lens runs. */
export async function listLensRunsForDocument(docId: string, viewerId: string): Promise<LensRun[]> {
  const [rows] = await pool.query<LensRunRow[]>(
    "SELECT lens_id, produced_count, ran_at FROM lens_runs WHERE doc_id = ? AND (owner_id IS NULL OR owner_id = ?)",
    [docId, viewerId],
  );
  return rows.map((row) => ({
    lensId: row.lens_id,
    producedCount: row.produced_count,
    ranAt: row.ran_at.toISOString(),
  }));
}

/** Separate from findDocumentById since most callers (evidence checks, annotation listing) never need the CharMap — it's only for reverse-mapping (client-side highlight rendering). */
export async function getCharMapForDocument(id: string): Promise<CharMap | null> {
  const [rows] = await pool.query<DocumentRow[]>(
    "SELECT content_hash FROM documents WHERE id = ? LIMIT 1",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return readCharMap(row.content_hash);
}

/** Creates the document and its IR Node tree (as produced by the reassembly layer, see ../reassembly/build-document.ts) in one transaction. Node ids/charRanges are already computed by the caller — this just persists them. */
export async function createDocumentWithNodes(params: {
  contentHash: string;
  title: string | null;
  pageCount: number;
  normalizedText: string;
  charMap: CharMap;
  nodes: IrNode[];
}): Promise<{ document: Document }> {
  const docId = uuid();
  // Persist large artifacts before acquiring database locks. On a failed DB
  // transaction the content-addressed files are retained for a safe retry.
  await writeDocumentContent(params.contentHash, params.normalizedText, params.charMap);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "INSERT INTO documents (id, content_hash, title, page_count) VALUES (?, ?, ?, ?)",
      [
        docId,
        params.contentHash,
        params.title,
        params.pageCount,
      ],
    );
    // Bound packet size and avoid one network round-trip per paragraph.
    for (let offset = 0; offset < params.nodes.length; offset += 250) {
      const values = params.nodes.slice(offset, offset + 250).map((node) => [
        node.id, docId, node.type, node.parentId, node.order,
        node.charRange.start, node.charRange.end, node.pageHint,
      ]);
      await conn.query(
        "INSERT INTO nodes (id, doc_id, type, parent_id, `order`, char_start, char_end, page_hint) VALUES ?",
        [values],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const created = await findDocumentById(docId);
  if (!created) throw new Error("Failed to read back newly-inserted document");
  return { document: created };
}

interface AgentAnnotationRow extends RowDataPacket {
  snapshot_owner_name?: string | null;
  lens_color?: string | null;
  lens_name?: string | null;
  owner_name?: string | null;
  id: string;
  doc_id: string;
  agent_id: string;
  agent_version: string;
  run_id: string;
  owner_id: string | null;
  anchor: string;
  evidence_span: string;
  comment: string;
  severity: AgentAnnotation["severity"];
  confidence: number;
  visibility: AgentAnnotation["visibility"];
  created_at: Date;
}

function toAgentAnnotation(row: AgentAnnotationRow): AgentAnnotation {
  return {
    id: row.id,
    docId: row.doc_id,
    agentId: row.agent_id,
    lensColor: lensColor(row.agent_id, row.lens_color),
    lensName: row.lens_name ?? undefined,
    ownerName: row.snapshot_owner_name ?? row.owner_name ?? undefined,
    agentVersion: row.agent_version,
    runId: row.run_id,
    ownerId: row.owner_id,
    anchor: JSON.parse(row.anchor),
    evidenceSpan: JSON.parse(row.evidence_span),
    comment: row.comment,
    severity: row.severity,
    confidence: row.confidence,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertAgentAnnotations(
  annotations: AgentAnnotation[],
  transaction?: PoolConnection,
): Promise<void> {
  if (annotations.length === 0) return;

  const conn = transaction ?? await pool.getConnection();
  try {
    if (!transaction) await conn.beginTransaction();
    for (const a of annotations) {
      await conn.query(
        `INSERT INTO agent_annotations
          (id, doc_id, agent_id, agent_version, run_id, owner_id, owner_name, lens_name, lens_color, anchor, evidence_span, comment, severity, confidence, visibility, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.id,
          a.docId,
          a.agentId,
          a.agentVersion,
          a.runId,
          a.ownerId,
          a.ownerName ?? null,
          a.lensName ?? null,
          a.lensColor ?? null,
          JSON.stringify(a.anchor),
          JSON.stringify(a.evidenceSpan),
          a.comment,
          a.severity,
          a.confidence,
          a.visibility,
          new Date(a.createdAt),
        ],
      );
    }
    if (!transaction) await conn.commit();
  } catch (err) {
    if (!transaction) await conn.rollback();
    throw err;
  } finally {
    if (!transaction) conn.release();
  }
}

/** Only runs the viewer may see: every `org` run, plus the viewer's own `private` runs (docs/02-decisions.md #5). */
export async function listAgentAnnotationsForDoc(
  docId: string,
  viewerId: string,
): Promise<AgentAnnotation[]> {
  const [rows] = await pool.query<AgentAnnotationRow[]>(
    "SELECT a.*, COALESCE(a.lens_color, l.color) AS lens_color, COALESCE(a.lens_name, l.name) AS lens_name, a.owner_name AS snapshot_owner_name, u.display_name AS owner_name FROM agent_annotations a LEFT JOIN lenses l ON l.id = a.agent_id LEFT JOIN users u ON u.id = a.owner_id WHERE a.doc_id = ? AND (a.visibility = 'org' OR a.owner_id = ?) ORDER BY a.created_at ASC",
    [docId, viewerId],
  );
  return rows.map(toAgentAnnotation);
}

/**
 * Switches a whole run between `private` and `org` — the run, not the
 * single annotation, is the unit of sharing (docs/02-decisions.md #5).
 * Only the run's owner can do this; org-lens runs have no owner and are
 * always `org`. Returns the number of annotations changed (0 = not found or
 * not the owner).
 */
export async function setAgentRunVisibility(
  runId: string,
  ownerId: string,
  visibility: Visibility,
): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE agent_annotations SET visibility = ? WHERE run_id = ? AND owner_id = ?",
    [visibility, runId, ownerId],
  );
  return result.affectedRows;
}

export async function findAgentRunOwner(runId: string): Promise<{ docId: string; ownerId: string | null } | null> {
  const [rows] = await pool.query<AgentAnnotationRow[]>(
    "SELECT doc_id, owner_id FROM agent_annotations WHERE run_id = ? LIMIT 1",
    [runId],
  );
  return rows[0] ? { docId: rows[0].doc_id, ownerId: rows[0].owner_id } : null;
}

interface UserRow extends RowDataPacket {
  id: string;
  display_name: string;
  email: string;
  sso_sub: string | null;
  role: Role;
  status: "pending" | "active";
}

function toUser(row: UserRow): User {
  return { id: row.id, displayName: row.display_name, email: row.email, role: row.role, status: row.status };
}

export async function listUsers(): Promise<User[]> {
  const [rows] = await pool.query<UserRow[]>("SELECT * FROM users ORDER BY created_at ASC");
  return rows.map(toUser);
}

/**
 * Changes a user's role (docs/02-decisions.md #4). Refuses to demote the
 * last remaining admin, which would lock everyone out of user management
 * short of editing the database by hand. The count and the update run in
 * one transaction with the admin rows locked, so two concurrent demotions
 * can't both pass the check.
 */
export async function setUserRole(
  userId: string,
  role: Role,
): Promise<{ ok: true; user: User } | { ok: false; reason: "not-found" | "last-admin" }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [targetRows] = await conn.query<UserRow[]>("SELECT * FROM users WHERE id = ? FOR UPDATE", [userId]);
    const target = targetRows[0];
    if (!target || target.status === "pending") {
      await conn.rollback();
      return { ok: false, reason: "not-found" };
    }
    if (target.role === "admin" && role !== "admin") {
      const [admins] = await conn.query<UserRow[]>("SELECT id FROM users WHERE role = 'admin' FOR UPDATE");
      if (admins.length <= 1) {
        await conn.rollback();
        return { ok: false, reason: "last-admin" };
      }
    }
    await conn.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
    await conn.commit();
    return { ok: true, user: { ...toUser(target), role } };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function findUserById(id: string): Promise<User | null> {
  const [rows] = await pool.query<UserRow[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/**
 * SSO gives us identity (sub/email/display name) only — never a role
 * (docs/02-decisions.md #4, #11). Links to an existing user by `sso_sub`
 * first, then falls back to linking by email (covers a user who existed
 * before SSO was wired up), and only creates a new row if neither matches.
 * New accounts remain pending members. The configured bootstrap email may
 * create the initial active admin only while no active admin exists.
 */
export async function upsertUserFromSso(params: {
  ssoSub: string;
  email: string;
  displayName: string;
  isBootstrapAdmin: boolean;
  invitationCode?: string;
}): Promise<User> {
  const [bySub] = await pool.query<UserRow[]>("SELECT * FROM users WHERE sso_sub = ? LIMIT 1", [
    params.ssoSub,
  ]);
  if (bySub[0]) return toUser(bySub[0]);

  const [byEmail] = await pool.query<UserRow[]>("SELECT * FROM users WHERE email = ? LIMIT 1", [
    params.email,
  ]);
  if (byEmail[0]) {
    await pool.query("UPDATE users SET sso_sub = ? WHERE id = ?", [params.ssoSub, byEmail[0].id]);
    return toUser(byEmail[0]);
  }

  // Check registration mode and invitation
  const [modeRows] = await pool.query<RowDataPacket[]>(
    "SELECT setting_value FROM org_settings WHERE setting_key = 'registration_mode'"
  );
  const registrationMode = modeRows[0]?.setting_value || "approval_required";

  let role: Role = "member";
  let status: "pending" | "active" = "pending";
  let invitationId: string | null = null;

  // Check if user has a valid invitation
  if (params.invitationCode) {
    const [invitationRows] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, role, expires_at, used_at FROM invitations WHERE code = ? AND used_at IS NULL",
      [params.invitationCode]
    );
    
    if (invitationRows[0]) {
      const invitation = invitationRows[0];
      const isExpired = invitation.expires_at && new Date(invitation.expires_at) < new Date();
      const emailMatches = !invitation.email || invitation.email.toLowerCase() === params.email.toLowerCase();
      
      if (!isExpired && emailMatches) {
        role = invitation.role as Role;
        status = "active";
        invitationId = invitation.id;
      }
    }
  }

  // Apply registration mode rules
  if (!invitationId) {
    const [activeAdmins] = await pool.query<RowDataPacket[]>("SELECT id FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1");
    const bootstrap = params.isBootstrapAdmin && activeAdmins.length === 0;
    
    if (bootstrap) {
      role = "admin";
      status = "active";
    } else if (registrationMode === "invite_only") {
      throw new Error("Registration requires an invitation code");
    } else if (registrationMode === "open") {
      status = "active";
    } else {
      // approval_required (default)
      status = "pending";
    }
  }

  const id = uuid();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("INSERT INTO users (id, display_name, email, sso_sub, role, status) VALUES (?, ?, ?, ?, ?, ?)",
      [id, params.displayName, params.email, params.ssoSub, role, status]);
    
    if (status === "pending") {
      const [admins] = await conn.query<RowDataPacket[]>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
      if (admins.length) await conn.query("INSERT INTO membership_notifications (id, recipient_id, applicant_id) VALUES ?",
        [admins.map(admin => [uuid(), admin.id, id])]);
    }
    
    if (invitationId) {
      await conn.query("UPDATE invitations SET used_at = NOW(3), used_by = ? WHERE id = ?", [id, invitationId]);
    }
    
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ER_DUP_ENTRY") {
      const [existing] = await pool.query<UserRow[]>("SELECT * FROM users WHERE sso_sub = ? LIMIT 1", [params.ssoSub]);
      if (existing[0]) return toUser(existing[0]);
    }
    throw err;
  } finally { conn.release(); }
  return { id, displayName: params.displayName, email: params.email, role, status };
}

export async function approveMembership(userId: string): Promise<User | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<UserRow[]>("SELECT * FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!rows[0]) { await conn.rollback(); return null; }
    await conn.query("UPDATE users SET status = 'active' WHERE id = ?", [userId]);
    await conn.query("UPDATE membership_notifications SET read_at = COALESCE(read_at, NOW(3)) WHERE applicant_id = ?", [userId]);
    await conn.commit();
    return { ...toUser(rows[0]), status: "active" };
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

export interface UserDeletionPreview {
  user: User;
  ownedCollections: number;
  annotations: number;
  personalLenses: number;
  personalProviders: number;
  privateLensAnnotations: number;
  sharedLensAnnotations: number;
}

export async function getUserDeletionPreview(userId: string): Promise<UserDeletionPreview | null> {
  const user = await findUserById(userId);
  if (!user) return null;
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM collections WHERE owner_id = ?) AS owned_collections,
    (SELECT COUNT(*) FROM human_annotations WHERE author_id = ?) AS annotations,
    (SELECT COUNT(*) FROM lenses WHERE owner_id = ?) AS personal_lenses,
    (SELECT COUNT(*) FROM providers WHERE owner_id = ?) AS personal_providers,
    (SELECT COUNT(*) FROM agent_annotations WHERE owner_id = ? AND visibility = 'private') AS private_lens_annotations,
    (SELECT COUNT(*) FROM agent_annotations WHERE owner_id = ? AND visibility = 'org') AS shared_lens_annotations`,
  [userId, userId, userId, userId, userId, userId]);
  const row = rows[0];
  return {
    user,
    ownedCollections: Number(row.owned_collections), annotations: Number(row.annotations),
    personalLenses: Number(row.personal_lenses), personalProviders: Number(row.personal_providers),
    privateLensAnnotations: Number(row.private_lens_annotations), sharedLensAnnotations: Number(row.shared_lens_annotations),
  };
}

export type DeleteUserResult = "deleted" | "not-found" | "self" | "last-admin";
export async function deleteUserAccount(actorId: string, targetId: string): Promise<DeleteUserResult> {
  if (actorId === targetId) return "self";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<UserRow[]>("SELECT * FROM users WHERE id = ? FOR UPDATE", [targetId]);
    const target = rows[0];
    if (!target) { await conn.rollback(); return "not-found"; }
    if (target.role === "admin" && target.status === "active") {
      const [admins] = await conn.query<UserRow[]>("SELECT * FROM users WHERE role = 'admin' AND status = 'active' FOR UPDATE");
      if (admins.length <= 1) { await conn.rollback(); return "last-admin"; }
    }

    // Snapshot names/colors before removing the personal lens configuration.
    await conn.query(`UPDATE agent_annotations a LEFT JOIN lenses l ON l.id = a.agent_id
      SET a.lens_name = COALESCE(a.lens_name, l.name), a.lens_color = COALESCE(a.lens_color, l.color), a.owner_name = COALESCE(a.owner_name, ?)
      WHERE a.owner_id = ? AND a.visibility = 'org'`, [target.display_name, targetId]);
    await conn.query("DELETE FROM agent_annotations WHERE owner_id = ? AND visibility = 'private'", [targetId]);
    await conn.query(`DELETE lr FROM lens_runs lr WHERE lr.owner_id = ? AND NOT EXISTS (
      SELECT 1 FROM agent_annotations a WHERE a.doc_id = lr.doc_id AND a.agent_id = lr.lens_id AND a.visibility = 'org')`, [targetId]);
    await conn.query("UPDATE agent_annotations SET owner_id = NULL WHERE owner_id = ?", [targetId]);
    await conn.query("UPDATE lens_runs SET owner_id = NULL WHERE owner_id = ?", [targetId]);
    await conn.query("UPDATE human_annotations SET author_id = NULL WHERE author_id = ?", [targetId]);
    await conn.query("UPDATE lenses SET provider_id = NULL WHERE provider_id IN (SELECT id FROM providers WHERE owner_id = ?)", [targetId]);
    await conn.query("DELETE FROM lenses WHERE owner_id = ?", [targetId]);
    await conn.query("DELETE FROM providers WHERE owner_id = ?", [targetId]);
    await conn.query("DELETE FROM users WHERE id = ?", [targetId]);
    await conn.commit();
    return "deleted";
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

interface SsoConfigRow extends RowDataPacket {
  id: string;
  provider_name: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  client_id: string;
  client_secret: string | null;
  scopes: string | null;
  account_management_url: string | null;
}

export interface SsoConfig {
  providerName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  scopes: string;
  accountManagementUrl: string | null;
}

function toSsoConfigPublic(row: SsoConfigRow): SsoConfigPublic {
  return {
    providerName: row.provider_name,
    authorizationEndpoint: row.authorization_endpoint,
    tokenEndpoint: row.token_endpoint,
    userinfoEndpoint: row.userinfo_endpoint,
    clientId: row.client_id,
    scopes: row.scopes ?? "",
    hasClientSecret: row.client_secret !== null && row.client_secret !== "",
    accountManagementUrl: row.account_management_url ?? undefined,
  };
}

/** Full config for OAuth token exchange and the explicit admin JSON backup download. */
export async function getSsoConfig(): Promise<SsoConfig> {
  const [rows] = await pool.query<SsoConfigRow[]>(
    "SELECT * FROM sso_config WHERE id = 'default' LIMIT 1",
  );
  const row = rows[0];
  if (!row) throw new Error("sso_config row missing — run pnpm db:install on an empty database");
  return {
    providerName: row.provider_name,
    authorizationEndpoint: row.authorization_endpoint,
    tokenEndpoint: row.token_endpoint,
    userinfoEndpoint: row.userinfo_endpoint,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    scopes: row.scopes ?? "",
    accountManagementUrl: row.account_management_url ?? null,
  };
}

/** Redacted view safe to return from an admin-panel GET. */
export async function getSsoConfigPublic(): Promise<SsoConfigPublic> {
  const [rows] = await pool.query<SsoConfigRow[]>(
    "SELECT * FROM sso_config WHERE id = 'default' LIMIT 1",
  );
  const row = rows[0];
  if (!row) throw new Error("sso_config row missing — run pnpm db:install on an empty database");
  return toSsoConfigPublic(row);
}

/** The account menu needs only this link, without exposing the admin SSO configuration. */
export async function getAccountManagementUrl(): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT account_management_url FROM sso_config WHERE id = 'default' LIMIT 1");
  return rows[0]?.account_management_url ?? null;
}

/**
 * Called once on server boot: if the admin hasn't configured a clientId yet,
 * seed it from MIRPASS_CLIENT_ID so a fresh checkout works without an admin
 * having touched the panel. Never overwrites an admin's existing choice.
 */
export async function seedSsoClientIdIfBlank(clientId: string): Promise<void> {
  if (!clientId) return;
  await pool.query(
    "UPDATE sso_config SET client_id = ? WHERE id = 'default' AND client_id = ''",
    [clientId],
  );
}

/** Same seed-once-if-blank pattern as seedSsoClientIdIfBlank, for MIRPASS_CLIENT_SECRET. */
export async function seedSsoClientSecretIfBlank(clientSecret: string): Promise<void> {
  if (!clientSecret) return;
  await pool.query(
    "UPDATE sso_config SET client_secret = ? WHERE id = 'default' AND (client_secret IS NULL OR client_secret = '')",
    [clientSecret],
  );
}

export async function updateSsoConfig(params: {
  providerName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  /** undefined = leave unchanged, null = clear, string = set. Mirrors the "never echo a secret back, but allow rotating it" pattern used for API keys elsewhere in this project. */
  clientSecret?: string | null;
  scopes: string;
  accountManagementUrl?: string | null;
}): Promise<SsoConfigPublic> {
  if (params.clientSecret === undefined) {
    await pool.query(
      `UPDATE sso_config SET provider_name = ?, authorization_endpoint = ?, token_endpoint = ?,
        userinfo_endpoint = ?, client_id = ?, scopes = ?, account_management_url = CASE WHEN ? THEN ? ELSE account_management_url END WHERE id = 'default'`,
      [
        params.providerName,
        params.authorizationEndpoint,
        params.tokenEndpoint,
        params.userinfoEndpoint,
        params.clientId,
        params.scopes,
        params.accountManagementUrl !== undefined,
        params.accountManagementUrl ?? null,
      ],
    );
  } else {
    await pool.query(
      `UPDATE sso_config SET provider_name = ?, authorization_endpoint = ?, token_endpoint = ?,
        userinfo_endpoint = ?, client_id = ?, client_secret = ?, scopes = ?, account_management_url = CASE WHEN ? THEN ? ELSE account_management_url END WHERE id = 'default'`,
      [
        params.providerName,
        params.authorizationEndpoint,
        params.tokenEndpoint,
        params.userinfoEndpoint,
        params.clientId,
        params.clientSecret,
        params.scopes,
        params.accountManagementUrl !== undefined,
        params.accountManagementUrl ?? null,
      ],
    );
  }
  return getSsoConfigPublic();
}

interface HumanAnnotationRow extends RowDataPacket {
  ai_provider_name?: string | null;
  ai_model?: string | null;
  ai_status?: NonNullable<HumanAnnotation["ai"]>["status"] | null;
  ai_error?: string | null;
  author_name: string | null;
  author_role: HumanAnnotation["authorRole"] | null;
  parent_id: string | null;
  parent_kind: "human" | "agent" | null;
  thread_root_id: string | null;
  thread_root_kind: "human" | "agent" | null;
  id: string;
  doc_id: string;
  author_id: string | null;
  anchor: string;
  body: string;
  visibility: Visibility;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function toHumanAnnotation(row: HumanAnnotationRow): HumanAnnotation {
  return {
    id: row.id, docId: row.doc_id, authorId: row.author_id,
    authorName: row.author_name ?? "Deleted user", authorRole: row.author_role ?? undefined,
    parentId: row.parent_id, parentKind: row.parent_kind,
    threadRootId: row.thread_root_id, threadRootKind: row.thread_root_kind,
    anchor: JSON.parse(row.anchor), body: row.deleted_at ? "" : row.body,
    visibility: row.visibility, version: row.version,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    ...(row.ai_status ? { ai: { providerName: row.ai_provider_name ?? "AI", model: row.ai_model ?? "",
      status: row.ai_status, error: row.ai_error ?? null } } : {}),
  };
}

export async function findHumanAnnotationById(id: string): Promise<HumanAnnotation | null> {
  const [rows] = await pool.query<HumanAnnotationRow[]>(
    `SELECT h.*, u.display_name AS author_name, u.role AS author_role,
     ar.provider_name AS ai_provider_name, ar.model AS ai_model, ar.status AS ai_status, ar.error AS ai_error
     FROM human_annotations h LEFT JOIN users u ON u.id = h.author_id
     LEFT JOIN ai_replies ar ON ar.reply_id = h.id WHERE h.id = ? LIMIT 1`, [id],
  );
  return rows[0] ? toHumanAnnotation(rows[0]) : null;
}

export async function findAgentAnnotationById(id: string): Promise<AgentAnnotation | null> {
  const [rows] = await pool.query<AgentAnnotationRow[]>("SELECT a.*, COALESCE(a.lens_color, l.color) AS lens_color, COALESCE(a.lens_name, l.name) AS lens_name, a.owner_name AS snapshot_owner_name, u.display_name AS owner_name FROM agent_annotations a LEFT JOIN lenses l ON l.id = a.agent_id LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ? LIMIT 1", [id]);
  return rows[0] ? toAgentAnnotation(rows[0]) : null;
}

/** Replies inherit access from the current root, including changes to agent-run sharing. */
export async function listHumanAnnotationsForDoc(docId: string, viewerId: string): Promise<HumanAnnotation[]> {
  const [rows] = await pool.query<HumanAnnotationRow[]>(
    `SELECT h.*, u.display_name AS author_name, u.role AS author_role,
     ar.provider_name AS ai_provider_name, ar.model AS ai_model, ar.status AS ai_status, ar.error AS ai_error
     FROM human_annotations h
     LEFT JOIN users u ON u.id = h.author_id
     LEFT JOIN ai_replies ar ON ar.reply_id = h.id
     LEFT JOIN human_annotations r ON h.thread_root_kind = 'human' AND r.id = h.thread_root_id AND r.doc_id = h.doc_id
     LEFT JOIN agent_annotations a ON h.thread_root_kind = 'agent' AND a.id = h.thread_root_id AND a.doc_id = h.doc_id
     WHERE h.doc_id = ? AND (
       (h.parent_id IS NULL AND (h.visibility = 'org' OR h.author_id = ?)) OR
       (h.parent_id IS NOT NULL AND ((r.id IS NOT NULL AND (r.visibility = 'org' OR r.author_id = ?)) OR
         (a.id IS NOT NULL AND (a.visibility = 'org' OR a.owner_id = ?))))
     ) ORDER BY h.created_at ASC, h.id ASC`,
    [docId, viewerId, viewerId, viewerId],
  );
  return rows.map(toHumanAnnotation);
}

export async function insertHumanAnnotation(params: {
  docId: string; authorId: string; anchor: Anchor; body: string; visibility: Visibility;
  parentId?: string; parentKind?: "human" | "agent";
  threadRootId?: string; threadRootKind?: "human" | "agent";
  notifyRecipientId?: string;
}): Promise<HumanAnnotation> {
  const id = uuid();
  const sql =
    `INSERT INTO human_annotations (id, doc_id, author_id, anchor, body, visibility, version, parent_id, parent_kind, thread_root_id, thread_root_kind)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`;
  const values = [id, params.docId, params.authorId, JSON.stringify(params.anchor), params.body, params.visibility,
      params.parentId ?? null, params.parentKind ?? null, params.threadRootId ?? null, params.threadRootKind ?? null];

  if (params.notifyRecipientId && params.notifyRecipientId !== params.authorId && params.parentId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(sql, values);
      await conn.query("INSERT INTO notifications (id, recipient_id, actor_id, doc_id, reply_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)",
        [uuid(), params.notifyRecipientId, params.authorId, params.docId, id, params.parentId]);
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  } else await pool.query(sql, values);
  const created = await findHumanAnnotationById(id);
  if (!created) throw new Error("Failed to read back newly-inserted human annotation");
  return created;
}

/**
 * Optimistic-lock result: `ok: false` means the caller's `expectedVersion`
 * didn't match, per docs/01-nabcd-architecture.md "实时协作" — the client
 * must be told "this was already modified" and shown the current row,
 * never have its write silently applied or silently dropped.
 */
export type OptimisticLockResult =
  | { ok: true; current: HumanAnnotation }
  | { ok: false; current: HumanAnnotation | null };

export async function updateHumanAnnotationBody(
  id: string,
  expectedVersion: number,
  newBody: string,
): Promise<OptimisticLockResult> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE human_annotations SET body = ?, version = version + 1 WHERE id = ? AND version = ? AND deleted_at IS NULL",
    [newBody, id, expectedVersion],
  );
  const current = await findHumanAnnotationById(id);
  if (result.affectedRows === 0) {
    return { ok: false, current };
  }
  return { ok: true, current: current! };
}

export async function softDeleteHumanAnnotation(
  id: string,
  expectedVersion: number,
  actorId: string,
  actorRole: Role,
): Promise<OptimisticLockResult> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE human_annotations h JOIN users u ON u.id = h.author_id SET h.deleted_at = NOW(3), h.version = h.version + 1 WHERE h.id = ? AND h.version = ? AND h.deleted_at IS NULL AND (h.author_id = ? OR (? = 'admin' AND u.role <> 'admin'))",
    [id, expectedVersion, actorId, actorRole],
  );
  const current = await findHumanAnnotationById(id);
  if (result.affectedRows === 0) {
    return { ok: false, current };
  }
  return { ok: true, current: current! };
}
