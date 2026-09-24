/**
 * Hand-written SQL migration runner. `node-pg-migrate` (candidate in
 * docs/02-decisions.md #12) is Postgres-only and doesn't apply now that the
 * database is MariaDB; hand-written SQL was the doc's own listed fallback,
 * so that's what this is. Numbered .sql files in ./migrations, applied in
 * order, tracked in a `_migrations` table so re-runs are idempotent.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const [rows] = await pool.query<any[]>("SELECT name FROM _migrations");
  return new Set(rows.map((r) => r.name));
}

function stripLineComments(sql: string): string {
  // Strip `-- ...` to end of line before splitting on `;`, so a semicolon
  // inside a comment (e.g. "-- see docs/foo.md #2") doesn't get mistaken
  // for a statement terminator.
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function splitStatements(sql: string): string[] {
  return stripLineComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip (already applied): ${file}`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const statements = splitStatements(sql);

    // Note: DDL in MariaDB auto-commits, so this isn't a real rollback
    // boundary for CREATE TABLE — it only protects the bookkeeping insert.
    const conn = await pool.getConnection();
    try {
      for (const statement of statements) {
        await conn.query(statement);
      }
      await conn.query("INSERT INTO _migrations (name) VALUES (?)", [file]);
      console.log(`applied: ${file}`);
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, {
        cause: err,
      });
    } finally {
      conn.release();
    }
  }

  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
