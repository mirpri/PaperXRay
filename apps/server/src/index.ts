import { createServer } from "node:http";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { attachUser } from "./auth/middleware.js";
import { healthRouter } from "./routes/health.js";
import { documentsRouter } from "./routes/documents.js";
import { documentTitlesRouter } from "./routes/document-titles.js";
import { collectionsRouter } from "./routes/collections.js";
import { humanAnnotationsRouter } from "./routes/human-annotations.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { votesRouter } from "./routes/votes.js";
import { notificationsRouter } from "./routes/notifications.js";
import { providersRouter } from "./routes/providers.js";
import { lensesRouter } from "./routes/lenses.js";
import { invitationsRouter } from "./routes/invitations.js";
import { initSocket } from "./realtime/socket.js";
import { seedSsoClientIdIfBlank, seedSsoClientSecretIfBlank } from "./db/repositories.js";
import { seedPresetLenses } from "./db/lens-repository.js";
import { PRESET_LENSES } from "./lenses/presets.js";
import { pool } from "./db/pool.js";
import { ensureHumanAnnotationColors } from "./db/human-annotation-colors.js";
import { isDatabaseUnavailable } from "./db/errors.js";
import { LENS_RUN_STATE_SCHEMA } from "./db/lens-run-state.js";
import { startLensRunWorker } from "./lenses/background-runs.js";
import { AI_REPLIES_SCHEMA, startAiReplyWorker } from "./lenses/ai-replies.js";
import { aiRepliesRouter } from "./routes/ai-replies.js";
import { paperSubscriptionsRouter } from "./routes/paper-subscriptions.js";
import { PAPER_SUBSCRIPTIONS_SCHEMA, PAPER_COMMENT_NOTIFICATIONS_SCHEMA } from "./db/paper-subscriptions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

app.use("/api", healthRouter);
app.use("/api", documentsRouter);
app.use("/api", documentTitlesRouter);
app.use("/api", collectionsRouter);
app.use("/api", humanAnnotationsRouter);
app.use("/api", aiRepliesRouter);
app.use("/api", paperSubscriptionsRouter);
app.use("/api", authRouter);
app.use("/api", adminRouter);
app.use("/api", lensesRouter);
app.use("/api", providersRouter);
app.use("/api", notificationsRouter);
app.use("/api", votesRouter);
app.use("/api", invitationsRouter);

// Serve frontend static files
const frontendDistPath = path.join(__dirname, "../../web/dist");
app.use(express.static(frontendDistPath));

// SPA fallback - serve index.html for all non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDistPath, "index.html"));
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) { _next(err); return; }
  if (isDatabaseUnavailable(err)) {
    res.setHeader("Retry-After", "3");
    res.status(503).json({ error: "Database temporarily unavailable. Please try again.", code: "database_unavailable" });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
};
app.use(errorHandler);

const httpServer = createServer(app);
initSocket(httpServer);

await seedSsoClientIdIfBlank(config.sso.mirpassClientId);
await seedSsoClientSecretIfBlank(config.sso.mirpassClientSecret);
await seedPresetLenses(PRESET_LENSES);
await pool.query(LENS_RUN_STATE_SCHEMA);
await pool.query(AI_REPLIES_SCHEMA);
await ensureHumanAnnotationColors();
await pool.query(PAPER_SUBSCRIPTIONS_SCHEMA);
await pool.query(PAPER_COMMENT_NOTIFICATIONS_SCHEMA);
startLensRunWorker();
startAiReplyWorker();

httpServer.listen(config.port, () => {
  console.log(`paper-xray server listening on :${config.port}`);
});
