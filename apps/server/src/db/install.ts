import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { config } from "../config.js";
import { pool } from "./pool.js";
import { seedPresetLenses } from "./lens-repository.js";
import { PRESET_LENSES } from "../lenses/presets.js";

export async function installDatabase(): Promise<void> {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  // Connect without selecting a database so a fresh database can be created.
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: "utf8mb4",
    multipleStatements: true, // Only the checked-in schema is executed as a batch.
  });

  try {
    const database = mysql.escapeId(config.db.database);
    await conn.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.changeUser({ database: config.db.database });
    const [tables] = await conn.query<RowDataPacket[]>("SHOW FULL TABLES");
    if (tables.length > 0) {
      throw new Error("Database is not empty. Installation requires a new or empty DB_NAME; existing data has been left untouched.");
    }

    // MariaDB DDL auto-commits. A failed installation may leave partial tables;
    // retry with a new empty database after fixing the reported error.
    await conn.query(schema);
    await conn.execute(
      `INSERT INTO sso_config
        (id, provider_name, authorization_endpoint, token_endpoint, userinfo_endpoint, client_id, client_secret, scopes)
       VALUES ('default', 'mirpass', 'https://api.pass.mirpri.com/oauth2/authorize',
         'https://api.pass.mirpri.com/oauth2/token', 'https://api.pass.mirpri.com/userinfo', ?, ?, '')`,
      [config.sso.mirpassClientId, config.sso.mirpassClientSecret || null],
    );
    await seedPresetLenses(PRESET_LENSES);
    console.log(`Installed latest database schema: ${config.db.database}`);
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  installDatabase()
    .catch((err: unknown) => {
      console.error("Database installation failed:", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
