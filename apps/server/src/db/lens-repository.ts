import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { LensDraft, LensScope, LensSpec } from "@paper-xray/contracts";
import { pool } from "./pool.js";

interface LensRow extends RowDataPacket {
  id: string;
  owner_id: string | null;
  name: string;
  description: string;
  version: string;
  kind: LensSpec["kind"];
  scope: LensScope;
  instruction: string;
  max_annotations: number;
  execution_context: LensSpec["executionContext"];
  strict_scope: number;
  share_runs_with_org: number;
}

function toLens(row: LensRow): LensSpec {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    kind: row.kind,
    scope: row.scope,
    instruction: row.instruction,
    outputSchema: { requiresEvidenceSpan: true, requiresComment: true, requiresSeverity: true },
    maxAnnotations: row.max_annotations,
    executionContext: row.execution_context,
    ownerId: row.owner_id,
    strictScope: row.strict_scope === 1,
    shareRunsWithOrg: row.share_runs_with_org === 1,
  };
}

/** Bumps the last numeric component of a semver-ish version: "1.0.3" -> "1.0.4", "4" -> "5". */
export function bumpVersion(version: string): string {
  const parts = version.split(".");
  const last = Number(parts[parts.length - 1]);
  parts[parts.length - 1] = Number.isFinite(last) ? String(last + 1) : "1";
  return parts.join(".");
}

/** Org lenses plus the viewer's own personal lenses, org first. */
export async function listLensesForUser(userId: string): Promise<LensSpec[]> {
  const [rows] = await pool.query<LensRow[]>(
    `SELECT * FROM lenses WHERE deleted_at IS NULL AND (owner_id IS NULL OR owner_id = ?)
     ORDER BY owner_id IS NOT NULL, created_at ASC`,
    [userId],
  );
  return rows.map(toLens);
}

export async function findLensById(id: string): Promise<LensSpec | null> {
  const [rows] = await pool.query<LensRow[]>("SELECT * FROM lenses WHERE id = ? AND deleted_at IS NULL LIMIT 1", [id]);
  return rows[0] ? toLens(rows[0]) : null;
}

/** Inserts each preset that isn't in the table yet. Never overwrites: once seeded, curators own the row. */
export async function seedPresetLenses(presets: LensSpec[]): Promise<void> {
  for (const p of presets) {
    await pool.query(
      `INSERT IGNORE INTO lenses
        (id, owner_id, name, description, version, kind, scope, instruction, max_annotations, execution_context, strict_scope, share_runs_with_org)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'org-server', ?, 1)`,
      [p.id, p.name, p.description, p.version, p.kind, p.scope, p.instruction, p.maxAnnotations, p.strictScope ? 1 : 0],
    );
  }
}

export async function insertLens(params: {
  id: string;
  ownerId: string | null;
  draft: LensDraft;
}): Promise<LensSpec> {
  const { id, ownerId, draft } = params;
  await pool.query(
    `INSERT INTO lenses
      (id, owner_id, name, description, version, kind, scope, instruction, max_annotations, execution_context, strict_scope, share_runs_with_org)
     VALUES (?, ?, ?, ?, '1', 'model', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ownerId,
      draft.name,
      draft.description,
      draft.scope,
      draft.instruction,
      draft.maxAnnotations,
      ownerId === null ? "org-server" : "personal-client",
      draft.strictScope ? 1 : 0,
      // Org lens runs are always org-visible (docs/02-decisions.md #5).
      ownerId === null || draft.shareRunsWithOrg ? 1 : 0,
    ],
  );
  const created = await findLensById(id);
  if (!created) throw new Error("Failed to read back newly-inserted lens");
  return created;
}

/** Saves a new definition and bumps the version, so annotations from earlier runs stay attributed to the version that produced them. */
export async function updateLens(existing: LensSpec, draft: LensDraft): Promise<LensSpec> {
  await pool.query(
    `UPDATE lenses SET name = ?, description = ?, scope = ?, instruction = ?, max_annotations = ?,
       strict_scope = ?, share_runs_with_org = ?, version = ?
     WHERE id = ?`,
    [
      draft.name,
      draft.description,
      draft.scope,
      draft.instruction,
      draft.maxAnnotations,
      draft.strictScope ? 1 : 0,
      existing.ownerId === null || draft.shareRunsWithOrg ? 1 : 0,
      bumpVersion(existing.version),
      existing.id,
    ],
  );
  const updated = await findLensById(existing.id);
  if (!updated) throw new Error("Failed to read back updated lens");
  return updated;
}

/** Soft delete: annotations already produced keep pointing at this lens id. */
export async function deleteLens(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE lenses SET deleted_at = NOW(3) WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  return result.affectedRows > 0;
}
