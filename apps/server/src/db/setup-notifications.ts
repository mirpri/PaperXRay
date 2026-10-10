import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "./pool.js";
export async function setupNotifications(): Promise<void> {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  const table = schema.match(/CREATE TABLE notifications \([\s\S]*?;/)?.[0];
  if (!table) throw new Error("Notifications schema not found");
  await pool.query(table.replace("CREATE TABLE notifications", "CREATE TABLE IF NOT EXISTS notifications"));
  console.log("Reply notifications table ready; existing data retained.");
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupNotifications().catch((err: unknown) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; }).finally(() => pool.end());
}
