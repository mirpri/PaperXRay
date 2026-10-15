import { Router, type Router as RouterType } from "express";
import { requireAuth } from "../auth/middleware.js";
import { pool } from "../db/pool.js";
import { isPaperSubscribed } from "../db/paper-subscriptions.js";

export const paperSubscriptionsRouter: RouterType = Router();
paperSubscriptionsRouter.get("/documents/:docId/subscription", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT id FROM documents WHERE id = ?", [req.params.docId]);
    if (!(rows as unknown[]).length) { res.status(404).json({ error: "Document not found" }); return; }
    res.json({ subscribed: await isPaperSubscribed(req.params.docId, req.user!.id) });
  } catch (err) { next(err); }
});
paperSubscriptionsRouter.put("/documents/:docId/subscription", requireAuth, async (req, res, next) => {
  try {
    if (typeof req.body?.subscribed !== "boolean") { res.status(400).json({ error: "subscribed must be a boolean" }); return; }
    const [rows] = await pool.query("SELECT id FROM documents WHERE id = ?", [req.params.docId]);
    if (!(rows as unknown[]).length) { res.status(404).json({ error: "Document not found" }); return; }
    if (req.body.subscribed) await pool.query("INSERT IGNORE INTO paper_subscriptions (doc_id, user_id) VALUES (?, ?)", [req.params.docId, req.user!.id]);
    else await pool.query("DELETE FROM paper_subscriptions WHERE doc_id = ? AND user_id = ?", [req.params.docId, req.user!.id]);
    res.json({ subscribed: await isPaperSubscribed(req.params.docId, req.user!.id) });
  } catch (err) { next(err); }
});
