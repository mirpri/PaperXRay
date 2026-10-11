import { Router, type Router as RouterType } from "express";
import { requireRole } from "../auth/middleware.js";
import { updateDocumentTitle } from "../db/repositories.js";
import { broadcastDocumentChanged } from "../realtime/socket.js";

export const documentTitlesRouter: RouterType = Router();

documentTitlesRouter.patch("/documents/:id", requireRole("admin"), async (req, res, next) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title || Array.from(title).length > 500 || /[\u0000-\u001f\u007f]/.test(title)) {
    res.status(400).json({ error: "Title must be 1–500 characters without control characters" });
    return;
  }
  try {
    const document = await updateDocumentTitle(req.params.id, title);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    broadcastDocumentChanged(document);
    res.json({ document });
  } catch (err) {
    next(err);
  }
});
