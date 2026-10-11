import { Router, type Router as RouterType } from "express";
import type { Anchor, Annotation, Visibility } from "@paper-xray/contracts";
import {
  findDocumentById,
  findAgentAnnotationById,
  findHumanAnnotationById,
  insertHumanAnnotation,
  softDeleteHumanAnnotation,
  updateHumanAnnotationBody,
} from "../db/repositories.js";
import { requireAuth } from "../auth/middleware.js";
import { findNotificationRecipient } from "../db/notifications.js";
import { broadcastAnnotationsChanged, broadcastNotificationsChanged } from "../realtime/socket.js";

export const humanAnnotationsRouter: RouterType = Router();

async function visibleRoot(annotation: Annotation, viewerId: string): Promise<Annotation | null> {
  let root: Annotation | null = annotation;
  if ("authorId" in annotation && annotation.parentId) {
    root = annotation.threadRootKind === "agent"
      ? await findAgentAnnotationById(annotation.threadRootId!)
      : await findHumanAnnotationById(annotation.threadRootId!);
  }
  if (!root || root.docId !== annotation.docId) return null;
  const owner = "authorId" in root ? root.authorId : root.ownerId;
  return root.visibility === "org" || owner === viewerId ? root : null;
}
function validBody(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 10000;
}
function validVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isValidAnchor(value: unknown): value is Anchor {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.nodeId === "string" &&
    typeof a.contextPrefix === "string" &&
    typeof a.contextSuffix === "string" &&
    typeof a.charRange === "object" &&
    a.charRange !== null &&
    typeof (a.charRange as Record<string, unknown>).start === "number" &&
    typeof (a.charRange as Record<string, unknown>).end === "number"
  );
}

humanAnnotationsRouter.post("/documents/:docId/human-annotations", requireAuth, async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.docId);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const { anchor, body, visibility } = req.body as {
      anchor?: unknown;
      body?: unknown;
      visibility?: Visibility;
    };

    if (!isValidAnchor(anchor) || !validBody(body)) {
      res.status(400).json({ error: "anchor and a non-empty body are required" });
      return;
    }
    if (visibility !== undefined && visibility !== "private" && visibility !== "org") {
      res.status(400).json({ error: "visibility must be 'private' or 'org'" });
      return;
    }

    // authorId always comes from the authenticated session — never from
    // client input (docs/02-decisions.md #11).
    const created = await insertHumanAnnotation({
      docId: req.params.docId,
      authorId: req.user!.id,
      anchor,
      body: body.trim(),
      visibility: visibility ?? "org",
    });

    broadcastAnnotationsChanged(req.params.docId);
    res.status(201).json({ annotation: created });
  } catch (err) {
    next(err);
  }
});

humanAnnotationsRouter.patch("/documents/:docId/human-annotations/:id", requireAuth, async (req, res, next) => {
  try {
    const { body, version } = req.body as { body?: unknown; version?: unknown };
    if (!validBody(body) || !validVersion(version)) {
      res.status(400).json({ error: "body (non-empty string) and version (number) are required" });
      return;
    }

    const existing = await findHumanAnnotationById(req.params.id);
    if (!existing || existing.docId !== req.params.docId || existing.deletedAt || !(await visibleRoot(existing, req.user!.id))) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    // Editing is always restricted to the comment author.
    if (existing.authorId !== req.user!.id) {
      res.status(403).json({ error: "You can only edit your own annotations" });
      return;
    }

    const result = await updateHumanAnnotationBody(req.params.id, version, body.trim());
    if (!result.ok) {
      res.status(409).json({ error: "This annotation was already modified", current: result.current });
      return;
    }

    broadcastAnnotationsChanged(req.params.docId);
    if (existing.authorId) broadcastNotificationsChanged(existing.authorId);
    if (existing.parentId) { const recipient = await findNotificationRecipient(existing.id); if (recipient) broadcastNotificationsChanged(recipient); }
    res.json({ annotation: result.current });
  } catch (err) {
    next(err);
  }
});

humanAnnotationsRouter.delete("/documents/:docId/human-annotations/:id", requireAuth, async (req, res, next) => {
  try {
    const version = Number(req.query.version);
    if (!validVersion(version)) {
      res.status(400).json({ error: "?version=<number> query param is required" });
      return;
    }

    const existing = await findHumanAnnotationById(req.params.id);
    if (!existing || existing.docId !== req.params.docId || existing.deletedAt || !(await visibleRoot(existing, req.user!.id))) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    if (existing.authorId !== req.user!.id && !(req.user!.role === "admin" && existing.authorRole !== "admin")) {
      res.status(403).json({ error: "You can delete your own comments; admins may also delete comments by non-admins" });
      return;
    }

    const result = await softDeleteHumanAnnotation(req.params.id, version, req.user!.id, req.user!.role);
    if (!result.ok) {
      res.status(409).json({ error: "This annotation was already modified", current: result.current });
      return;
    }

    broadcastAnnotationsChanged(req.params.docId);
    if (existing.authorId) broadcastNotificationsChanged(existing.authorId);
    if (existing.parentId) { const recipient = await findNotificationRecipient(existing.id); if (recipient) broadcastNotificationsChanged(recipient); }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Any authenticated viewer of a thread can reply, including to another reply. */
humanAnnotationsRouter.post("/documents/:docId/annotations/:parentId/replies", requireAuth, async (req, res, next) => {
  try {
    const { body, parentKind } = req.body as { body?: unknown; parentKind?: unknown };
    if (!validBody(body) || (parentKind !== "human" && parentKind !== "agent")) {
      res.status(400).json({ error: "A comment of 1–10000 characters and parentKind (human or agent) are required" }); return;
    }
    const parent = parentKind === "human" ? await findHumanAnnotationById(req.params.parentId) : await findAgentAnnotationById(req.params.parentId);
    const root = parent && parent.docId === req.params.docId ? await visibleRoot(parent, req.user!.id) : null;
    if (!parent || !root) { res.status(404).json({ error: "Comment not found" }); return; }
    const recipientId = "authorId" in parent && parent.authorId !== req.user!.id ? parent.authorId : null;
    const created = await insertHumanAnnotation({
      ...(recipientId ? { notifyRecipientId: recipientId } : {}),
      docId: req.params.docId, authorId: req.user!.id, anchor: root.anchor, body: body.trim(), visibility: root.visibility,
      parentId: parent.id, parentKind, threadRootId: root.id, threadRootKind: "authorId" in root ? "human" : "agent",
    });
    broadcastAnnotationsChanged(req.params.docId);
    if (recipientId) broadcastNotificationsChanged(recipientId);
    res.status(201).json({ annotation: created });
  } catch (err) { next(err); }
});
