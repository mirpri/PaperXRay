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
import { pool } from "./pool.js";

interface DocumentRow extends RowDataPacket {
  id: string;
  content_hash: string;
  original_filename: string | null;
  page_count: number;
  normalized_text: string;
  char_map: string | null;
  created_at: Date;
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    contentHash: row.content_hash,
    originalFilename: row.original_filename,
    pageCount: row.page_count,
    normalizedText: row.normalized_text,
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

/** Library page projection — every column except normalized_text/char_map, which a list view never needs and which can be large. */
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
    "SELECT * FROM documents WHERE content_hash = ? LIMIT 1",
    [contentHash],
  );
  return rows[0] ? toDocument(rows[0]) : null;
}

export async function findDocumentById(id: string): Promise<Document | null> {
  const [rows] = await pool.query<DocumentRow[]>(
    "SELECT * FROM documents WHERE id = ? LIMIT 1",
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
    "SELECT char_map FROM documents WHERE id = ? LIMIT 1",
    [id],
  );
  const row = rows[0];
  if (!row || row.char_map === null) return null;
  return JSON.parse(row.char_map) as CharMap;
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

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "INSERT INTO documents (id, content_hash, original_filename, page_count, normalized_text, char_map) VALUES (?, ?, ?, ?, ?, ?)",
      [
        docId,
        params.contentHash,
        params.originalFilename,
        params.pageCount,
        params.normalizedText,
        JSON.stringify(params.charMap),
      ],
    );
    for (const node of params.nodes) {
      await conn.query(
        `INSERT INTO nodes (id, doc_id, type, parent_id, \`order\`, char_start, char_end, page_hint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          node.id,
          docId,
          node.type,
          node.parentId,
          node.order,
          node.charRange.start,
          node.charRange.end,
          node.pageHint,
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

  const created = await findDocumentById(docId);
  if (!created) throw new Error("Failed to read back newly-inserted document");
  return { document: created };
}

interface AgentAnnotationRow extends RowDataPacket {
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
    "SELECT * FROM agent_annotations WHERE doc_id = ? AND (visibility = 'org' OR owner_id = ?) ORDER BY created_at ASC",
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
}

export interface SsoConfig {
  providerName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  scopes: string;
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
  };
}

/** Full config including client_secret, for server-internal use only (the OAuth callback's token exchange) — never send this shape to a client. */
export async function getSsoConfig(): Promise<SsoConfig> {
  const [rows] = await pool.query<SsoConfigRow[]>(
    "SELECT * FROM sso_config WHERE id = 'default' LIMIT 1",
  );
  const row = rows[0];
  if (!row) throw new Error("sso_config row missing — did migrations run?");
  return {
    providerName: row.provider_name,
    authorizationEndpoint: row.authorization_endpoint,
    tokenEndpoint: row.token_endpoint,
    userinfoEndpoint: row.userinfo_endpoint,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    scopes: row.scopes ?? "",
  };
}

/** Redacted view safe to return from an admin-panel GET. */
export async function getSsoConfigPublic(): Promise<SsoConfigPublic> {
  const [rows] = await pool.query<SsoConfigRow[]>(
    "SELECT * FROM sso_config WHERE id = 'default' LIMIT 1",
  );
  const row = rows[0];
  if (!row) throw new Error("sso_config row missing — did migrations run?");
  return toSsoConfigPublic(row);
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
}): Promise<SsoConfigPublic> {
  if (params.clientSecret === undefined) {
    await pool.query(
      `UPDATE sso_config SET provider_name = ?, authorization_endpoint = ?, token_endpoint = ?,
        userinfo_endpoint = ?, client_id = ?, scopes = ? WHERE id = 'default'`,
      [
        params.providerName,
        params.authorizationEndpoint,
        params.tokenEndpoint,
        params.userinfoEndpoint,
        params.clientId,
        params.scopes,
      ],
    );
  } else {
    await pool.query(
      `UPDATE sso_config SET provider_name = ?, authorization_endpoint = ?, token_endpoint = ?,
        userinfo_endpoint = ?, client_id = ?, client_secret = ?, scopes = ? WHERE id = 'default'`,
      [
        params.providerName,
        params.authorizationEndpoint,
        params.tokenEndpoint,
        params.userinfoEndpoint,
        params.clientId,
        params.clientSecret,
        params.scopes,
      ],
    );
  }
  return getSsoConfigPublic();
}

interface HumanAnnotationRow extends RowDataPacket {
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
    id: row.id,
    docId: row.doc_id,
    authorId: row.author_id,
    anchor: JSON.parse(row.anchor),
    body: row.body,
    visibility: row.visibility,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  };
}

export async function findHumanAnnotationById(id: string): Promise<HumanAnnotation | null> {
  const [rows] = await pool.query<HumanAnnotationRow[]>(
    "SELECT * FROM human_annotations WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ? toHumanAnnotation(rows[0]) : null;
}

/** Excludes soft-deleted rows and other users' `private` annotations (docs/02-decisions.md #5). */
export async function listHumanAnnotationsForDoc(docId: string, viewerId: string): Promise<HumanAnnotation[]> {
  const [rows] = await pool.query<HumanAnnotationRow[]>(
    "SELECT * FROM human_annotations WHERE doc_id = ? AND deleted_at IS NULL AND (visibility = 'org' OR author_id = ?) ORDER BY created_at ASC",
    [docId, viewerId],
  );
  return rows.map(toHumanAnnotation);
}

export async function insertHumanAnnotation(params: {
  docId: string;
  authorId: string;
  anchor: Anchor;
  body: string;
  visibility: Visibility;
}): Promise<HumanAnnotation> {
  const id = uuid();
  await pool.query(
    `INSERT INTO human_annotations (id, doc_id, author_id, anchor, body, visibility, version)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, params.docId, params.authorId, JSON.stringify(params.anchor), params.body, params.visibility],
  );
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
): Promise<OptimisticLockResult> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE human_annotations SET deleted_at = NOW(3), version = version + 1 WHERE id = ? AND version = ? AND deleted_at IS NULL",
    [id, expectedVersion],
  );
  const current = await findHumanAnnotationById(id);
  if (result.affectedRows === 0) {
    return { ok: false, current };
  }
  return { ok: true, current: current! };
}
