import { pathToFileURL } from "node:url";
import type { RowDataPacket } from "mysql2";
import { pool } from "./pool.js";

const statements = [
  `CREATE TABLE IF NOT EXISTS collections (
    id CHAR(36) NOT NULL PRIMARY KEY,
    owner_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_collections_owner_name (owner_id, name),
    KEY idx_collections_owner_updated (owner_id, updated_at, id),
    CONSTRAINT chk_collections_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT fk_collections_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS collection_members (
    collection_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (collection_id, user_id),
    KEY idx_collection_members_user (user_id, created_at, collection_id),
    CONSTRAINT fk_collection_members_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
    CONSTRAINT fk_collection_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS collection_documents (
    collection_id CHAR(36) NOT NULL,
    doc_id CHAR(36) NOT NULL,
    added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (collection_id, doc_id),
    KEY idx_collection_documents_added (collection_id, added_at, doc_id),
    KEY idx_collection_documents_doc (doc_id, collection_id),
    CONSTRAINT fk_collection_documents_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
    CONSTRAINT fk_collection_documents_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
  ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS collection_notifications (
    id CHAR(36) NOT NULL PRIMARY KEY,
    recipient_id CHAR(36) NOT NULL,
    actor_id CHAR(36) NOT NULL,
    collection_id CHAR(36) NOT NULL,
    kind ENUM('collection_shared', 'collection_left') NOT NULL,
    read_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_collection_notifications_inbox (recipient_id, read_at, created_at, id),
    CONSTRAINT fk_collection_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_collection_notifications_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_collection_notifications_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
  ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`,
];

export async function setupCollections(): Promise<void> {
  const [tables] = await pool.query<RowDataPacket[]>("SHOW TABLES");
  const names = tables.flatMap(row => Object.values(row).filter((value): value is string => typeof value === "string"));
  if (!names.includes("users") || !names.includes("documents")) throw new Error("Install the current Paper X-Ray schema before adding collections");
  for (const statement of statements) await pool.query(statement);
  console.log("Collections, sharing, document membership, and collection notification tables are ready; existing library records retained.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupCollections().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }).finally(() => pool.end());
}
