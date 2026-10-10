import { Router, type Router as RouterType } from "express";
import type { Annotation } from "@paper-xray/contracts";
import { requireAuth } from "../auth/middleware.js";
import { findAgentAnnotationById, findHumanAnnotationById } from "../db/repositories.js";
import { setAnnotationVote } from "../db/votes.js";
import { broadcastAnnotationsChanged, broadcastNotificationsChanged } from "../realtime/socket.js";

export const votesRouter: RouterType = Router();
votesRouter.put("/documents/:docId/annotations/:id/vote", requireAuth, async (req, res, next) => {
  try {
    const { kind, value } = req.body as { kind?: unknown; value?: unknown };
    if ((kind !== "human" && kind !== "agent") || (value !== -1 && value !== 0 && value !== 1)) {
      res.status(400).json({ error: "kind (human or agent) and value (-1, 0, or 1) are required" }); return;
    }
    const target = kind === "human" ? await findHumanAnnotationById(req.params.id) : await findAgentAnnotationById(req.params.id);
    if (!target || target.docId !== req.params.docId || ("authorId" in target && target.deletedAt)) {
      res.status(404).json({ error: "Annotation not found" }); return;
    }
    let root: Annotation | null = target;
    if ("authorId" in target && target.parentId) {
      root = target.threadRootKind === "agent" ? await findAgentAnnotationById(target.threadRootId!) : await findHumanAnnotationById(target.threadRootId!);
    }
    const owner = root && ("authorId" in root ? root.authorId : root.ownerId);
    if (!root || root.docId !== target.docId || (root.visibility !== "org" && owner !== req.user!.id)) {
      res.status(404).json({ error: "Annotation not found" }); return;
    }
    const targetOwner = "authorId" in target ? target.authorId : target.ownerId;
    const recipientId = targetOwner !== req.user!.id ? targetOwner : null;
    const votes = await setAnnotationVote({ docId: target.docId, annotationId: target.id, kind, voterId: req.user!.id, value, recipientId });
    broadcastAnnotationsChanged(target.docId);
    if (recipientId) broadcastNotificationsChanged(recipientId);
    res.json({ votes });
  } catch (err) { next(err); }
});
