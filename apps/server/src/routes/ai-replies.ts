import { Router, type Router as RouterType } from "express";
import { requireAuth } from "../auth/middleware.js";
import { pool } from "../db/pool.js";
import type { RowDataPacket } from "mysql2";
import { findProvider } from "../db/providers.js";
import { findAgentAnnotationById, findHumanAnnotationById } from "../db/repositories.js";
import { visibleRoot } from "../discussion/access.js";
import { aiReplyContext, createAiReply, finishAiReply } from "../lenses/ai-replies.js";
import { broadcastAnnotationsChanged } from "../realtime/socket.js";

export const aiRepliesRouter: RouterType = Router();

aiRepliesRouter.post("/documents/:docId/annotations/:parentId/ai-replies", requireAuth, async (req, res, next) => {
  try {
    const { providerId, model, parentKind } = req.body ?? {};
    if (typeof providerId !== "string" || providerId.length > 64 || typeof model !== "string" ||
        !model.trim() || model.length > 255 ||
        (parentKind !== "human" && parentKind !== "agent")) {
      res.status(400).json({ error: "Choose a provider and model" }); return;
    }
    const parent = parentKind === "human" ? await findHumanAnnotationById(req.params.parentId) : await findAgentAnnotationById(req.params.parentId);
    const root = parent && parent.docId === req.params.docId ? await visibleRoot(parent, req.user!.id) : null;
    if (!parent || !root || ("authorId" in parent && parent.deletedAt)) {
      res.status(404).json({ error: "Comment not found" }); return;
    }
    if ("authorId" in parent && (parent.ai?.status === "queued" || parent.ai?.status === "running")) {
      res.status(409).json({ error: "Wait for the AI reply to finish before replying" }); return;
    }
    const provider = await findProvider(providerId);
    if (!provider || (provider.ownerId !== null && provider.ownerId !== req.user!.id)) {
      res.status(404).json({ error: "Provider not found" }); return;
    }
    const created = await createAiReply({ parent, root, userId: req.user!.id, provider, model: model.trim() });
    let messages;
    if (provider.ownerId !== null && !created.reused) {
      try { messages = (await aiReplyContext(created.replyId)).messages; }
      catch (err) { await finishAiReply(created.replyId, null, "", "Could not load the paper or discussion context. Please try again."); throw err; }
    }
    const annotation = await findHumanAnnotationById(created.replyId);
    broadcastAnnotationsChanged(req.params.docId);
    res.status(202).json({ annotation, executionContext: provider.ownerId === null ? "org-server" : "personal-client",
      reused: created.reused, ...(messages ? { messages } : {}) });
  } catch (err) { next(err); }
});

/** Personal credentials stay in the browser; only its generated answer is submitted. */
aiRepliesRouter.put("/documents/:docId/ai-replies/:replyId/client-result", requireAuth, async (req, res, next) => {
  try {
    const { body, failed } = req.body ?? {};
    if (failed !== true && (typeof body !== "string" || !body.trim() || body.length > 10000)) {
      res.status(400).json({ error: "AI answer must contain 1–10000 characters" }); return;
    }
    const reply = await findHumanAnnotationById(req.params.replyId);
    if (!reply || reply.docId !== req.params.docId || reply.authorId !== req.user!.id || reply.deletedAt || !await visibleRoot(reply, req.user!.id)) {
      res.status(404).json({ error: "AI reply not found" }); return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ar.reply_id FROM ai_replies ar JOIN providers p ON p.id = ar.provider_id
       WHERE ar.reply_id = ? AND ar.status = 'running' AND ar.claim_token IS NULL AND p.owner_id = ? AND p.deleted_at IS NULL`,
      [reply.id, req.user!.id],
    );
    if (!rows[0]) { res.status(409).json({ error: "This AI reply is no longer accepting a browser result" }); return; }
    await finishAiReply(reply.id, null, failed ? "" : body.trim(), failed ? "Personal model request failed or was interrupted. Please try again." : null);
    res.json({ annotation: await findHumanAnnotationById(reply.id) });
  } catch (err) { next(err); }
});
