import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import type {
  AgentAnnotation,
  Anchor,
  CharMap,
  Document,
  DocumentSummary,
  HumanAnnotation,
  Node as IrNode,
  Role,
  SsoConfigPublic,
  User,
  Visibility,
} from "@paper-xray/contracts";
import { lensColor } from "@paper-xray/contracts";
import { pool } from "./pool.js";
import { readCharMap, readNormalizedText, writeDocumentContent } from "../storage/document-files.js";

interface DocumentRow extends RowDataPacket {
  id: string;
  content_hash: string;
  original_filename: string | null;
  page_count: number;
  created_at: Date;
}

async function toDocument(row: DocumentRow): Promise<Document> {
  return {
    id: row.id,
    contentHash: row.content_hash,
    originalFilename: row.original_filename,
    pageCount: row.page_count,
    normalizedText: await readNormalizedText(row.content_hash),
    createdAt: row.created_at.toISOString(),
  };
}

function toDocumentSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    contentHash: row.content_hash,
    originalFilename: row.original_filename,
    pageCount: row.page_count,
    createdAt: row.created_at.toISOString(),
  };
}

/** Library listing reads metadata only; full text and CharMap live in file storage. */
export async function listDocuments(): Promise<DocumentSummary[]> {
  const [rows] = await pool.query<DocumentRow[]>(
    "SELECT id, content_hash, original_filename, page_count, created_at FROM documents ORDER BY created_at DESC",
  );
  return rows.map(toDocumentSummary);
}

export async function findDocumentByContentHash(
  contentHash: string,
): Promise<Document | null> {
  const [rows] = await pool.query<DocumentRow[]>(
    "SELECT id, content_hash, original_filename, page_count, created_at FROM documents WHERE content_hash = ? LIMIT 1",
    [contentHash],
  );
  return rows[0] ? toDocument(rows[0]) : null;
}

export async function findDocumentById(id: string): Promise<Document | null> {
  const [rows] = await pool.query<DocumentRow[]>(
    "SELECT id, content_hash, original_filename, page_count, created_at FROM documents WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ? toDocument(rows[0]) : null;
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
): Promise<void> {
  await pool.query(
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
  originalFilename: string | null;
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
      "INSERT INTO documents (id, content_hash, original_filename, page_count) VALUES (?, ?, ?, ?)",
      [
        docId,
        params.contentHash,
        params.originalFilename,
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
    ownerName: row.owner_name ?? undefined,
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
): Promise<void> {
  if (annotations.length === 0) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const a of annotations) {
      await conn.query(
        `INSERT INTO agent_annotations
          (id, doc_id, agent_id, agent_version, run_id, owner_id, anchor, evidence_span, comment, severity, confidence, visibility, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.id,
          a.docId,
          a.agentId,
          a.agentVersion,
          a.runId,
          a.ownerId,
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
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Only runs the viewer may see: every `org` run, plus the viewer's own `private` runs (docs/02-decisions.md #5). */
export async function listAgentAnnotationsForDoc(
  docId: string,
  viewerId: string,
): Promise<AgentAnnotation[]> {
  const [rows] = await pool.query<AgentAnnotationRow[]>(
    "SELECT a.*, l.color AS lens_color, l.name AS lens_name, u.display_name AS owner_name FROM agent_annotations a LEFT JOIN lenses l ON l.id = a.agent_id LEFT JOIN users u ON u.id = a.owner_id WHERE a.doc_id = ? AND (a.visibility = 'org' OR a.owner_id = ?) ORDER BY a.created_at ASC",
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
}

function toUser(row: UserRow): User {
  return { id: row.id, displayName: row.display_name, email: row.email, role: row.role };
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
    if (!target) {
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
 * A brand-new user's role is 'member' unless their email is in
 * config.sso.adminEmails, which bootstraps the very first admin.
 */
export async function upsertUserFromSso(params: {
  ssoSub: string;
  email: string;
  displayName: string;
  isBootstrapAdmin: boolean;
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

  const id = uuid();
  const role: Role = params.isBootstrapAdmin ? "admin" : "member";
  await pool.query(
    "INSERT INTO users (id, display_name, email, sso_sub, role) VALUES (?, ?, ?, ?, ?)",
    [id, params.displayName, params.email, params.ssoSub, role],
  );
  return { id, displayName: params.displayName, email: params.email, role };
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
  author_name: string;
  author_role: HumanAnnotation["authorRole"];
  parent_id: string | null;
  parent_kind: "human" | "agent" | null;
  thread_root_id: string | null;
  thread_root_kind: "human" | "agent" | null;
  id: string;
  doc_id: string;
  author_id: string;
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
    authorName: row.author_name, authorRole: row.author_role,
    parentId: row.parent_id, parentKind: row.parent_kind,
    threadRootId: row.thread_root_id, threadRootKind: row.thread_root_kind,
    anchor: JSON.parse(row.anchor), body: row.deleted_at ? "" : row.body,
    visibility: row.visibility, version: row.version,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  };
}

export async function findHumanAnnotationById(id: string): Promise<HumanAnnotation | null> {
  const [rows] = await pool.query<HumanAnnotationRow[]>(
    "SELECT h.*, u.display_name AS author_name, u.role AS author_role FROM human_annotations h JOIN users u ON u.id = h.author_id WHERE h.id = ? LIMIT 1", [id],
  );
  return rows[0] ? toHumanAnnotation(rows[0]) : null;
}

export async function findAgentAnnotationById(id: string): Promise<AgentAnnotation | null> {
  const [rows] = await pool.query<AgentAnnotationRow[]>("SELECT a.*, l.color AS lens_color, l.name AS lens_name, u.display_name AS owner_name FROM agent_annotations a LEFT JOIN lenses l ON l.id = a.agent_id LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ? LIMIT 1", [id]);
  return rows[0] ? toAgentAnnotation(rows[0]) : null;
}

/** Replies inherit access from the current root, including changes to agent-run sharing. */
export async function listHumanAnnotationsForDoc(docId: string, viewerId: string): Promise<HumanAnnotation[]> {
  const [rows] = await pool.query<HumanAnnotationRow[]>(
    `SELECT h.*, u.display_name AS author_name, u.role AS author_role FROM human_annotations h
     JOIN users u ON u.id = h.author_id
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
