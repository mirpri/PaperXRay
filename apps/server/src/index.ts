import { createServer } from "node:http";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { config } from "./config.js";
import { attachUser } from "./auth/middleware.js";
import { healthRouter } from "./routes/health.js";
import { documentsRouter } from "./routes/documents.js";
import { humanAnnotationsRouter } from "./routes/human-annotations.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { lensesRouter } from "./routes/lenses.js";
import { initSocket } from "./realtime/socket.js";
import { seedSsoClientIdIfBlank, seedSsoClientSecretIfBlank } from "./db/repositories.js";
import { seedPresetLenses } from "./db/lens-repository.js";
import { PRESET_LENSES } from "./lenses/presets.js";

const app = express();
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

app.use("/api", healthRouter);
app.use("/api", documentsRouter);
app.use("/api", humanAnnotationsRouter);
app.use("/api", authRouter);
app.use("/api", adminRouter);
app.use("/api", lensesRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
};
app.use(errorHandler);

const httpServer = createServer(app);
initSocket(httpServer);

await seedSsoClientIdIfBlank(config.sso.mirpassClientId);
await seedSsoClientSecretIfBlank(config.sso.mirpassClientSecret);
await seedPresetLenses(PRESET_LENSES);

httpServer.listen(config.port, () => {
  console.log(`paper-xray server listening on :${config.port}`);
});
