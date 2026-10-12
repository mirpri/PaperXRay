import mysql from "mysql2/promise";
import { config } from "../config.js";

/**
 * Single shared pool. Per docs/02-decisions.md #12: InnoDB, DYNAMIC row
 * format, utf8mb4 (metadata and annotations can contain symbols that don't
 * fit 3-byte utf8).
 */
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
});
