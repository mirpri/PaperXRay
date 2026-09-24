import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  webOrigin: required("WEB_ORIGIN", "http://localhost:5173"),
  db: {
    host: required("DB_HOST", "127.0.0.1"),
    port: Number(process.env.DB_PORT ?? 3306),
    user: required("DB_USER", "paperxray"),
    password: required("DB_PASSWORD", "paperxray"),
    database: required("DB_NAME", "paperxray"),
  },
  session: {
    // Dev-only fallback so a missing .env doesn't hard-crash local setup;
    // any shared/deployed environment must set a real SESSION_SECRET.
    secret: required("SESSION_SECRET", "dev-only-change-me"),
  },
  sso: {
    // Bootstrap defaults for the sso_config table's first migration seed row
    // (docs/02-decisions.md #11) — admin panel can change all of this at
    // runtime, this is just what unblocks local dev out of the box.
    mirpassClientId: process.env.MIRPASS_CLIENT_ID ?? "",
    mirpassClientSecret: process.env.MIRPASS_CLIENT_SECRET ?? "",
    mirpassRedirectUri: required("MIRPASS_REDIRECT_URI", "http://localhost:3001/api/auth/callback"),
    adminEmails: (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },
  // Raw PDF bytes on disk, keyed by content hash — needed so the client can
  // re-render pages with pdfjs-dist for the highlight overlay (reverse
  // mapping assumes the same bytes on both sides, docs/02-decisions.md #12).
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(__dirname, "..", "uploads"),
  urlImport: {
    // Host allowlist for POST /documents/import (docs/02-decisions.md #7).
    // A host matches itself and its subdomains. Override with a
    // comma-separated IMPORT_ALLOWED_HOSTS; the default covers the usual
    // open-access paper sources.
    allowedHosts: (
      process.env.IMPORT_ALLOWED_HOSTS ??
      "arxiv.org,openreview.net,aclanthology.org,proceedings.neurips.cc,proceedings.mlr.press,openaccess.thecvf.com,usenix.org,biorxiv.org,medrxiv.org"
    )
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    maxBytes: 50 * 1024 * 1024,
    timeoutMs: 30_000,
  },
  ppio: {
    apiKey: process.env.PPIO_API_KEY ?? "",
    baseUrl: process.env.PPIO_BASE_URL ?? "https://api.ppio.com/openai",
    model: process.env.PPIO_MODEL ?? "deepseek/deepseek-v3-turbo",
  },
};
