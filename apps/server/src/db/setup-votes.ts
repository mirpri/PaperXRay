import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "./pool.js";

export async function setupVotes(): Promise<void> {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  for (const name of ["annotation_votes", "vote_notifications"]) {
    const table = schema.match(new RegExp("CREATE TABLE " + name + " \\([\\s\\S]*?;"))?.[0];
    if (!table) throw new Error(`${name} schema not found`);
    await pool.query(table.replace(`CREATE TABLE ${name}`, `CREATE TABLE IF NOT EXISTS ${name}`));
  }
  // Preserve existing notification IDs, read status and timestamps; safe to run again.
  await pool.query(`INSERT IGNORE INTO vote_notifications
    (id, doc_id, annotation_id, annotation_kind, voter_id, recipient_id, kind, read_at, created_at)
    SELECT id, doc_id, annotation_id, annotation_kind, voter_id, recipient_id,
      CASE WHEN value = 1 THEN 'upvote' ELSE 'downvote' END, notification_read_at, updated_at
    FROM annotation_votes WHERE recipient_id IS NOT NULL`);
  console.log("Votes and notification history ready; existing messages retained.");
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupVotes().catch((err: unknown) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; }).finally(() => pool.end());
}
