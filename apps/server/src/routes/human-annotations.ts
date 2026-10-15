import { Router, type Router as RouterType } from "express";
import type { Anchor, CharRange, Visibility } from "@paper-xray/contracts";
import { codePointLength, isLensColor } from "@paper-xray/contracts";
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
import { visibleRoot } from "../discussion/access.js";
import { cancelAiReply } from "../lenses/ai-replies.js";
import { findPaperCommentRecipients } from "../db/paper-subscriptions.js";

export const humanAnnotationsRouter: RouterType = Router();

function validBody(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 10000;
}
function validVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function validRange(value: unknown): value is CharRange {
  if (!value || typeof value !== "object") return false;
  const range = value as CharRange;
  return Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end > range.start;
}

function isValidAnchor(value: unknown): value is Anchor {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  const valid = (
    typeof a.nodeId === "string" &&
    typeof a.contextPrefix === "string" &&
    typeof a.contextSuffix === "string" &&
    validRange(a.charRange)
  );
  if (!valid) return false;
  if (a.charRanges === undefined) return true;
  const enclosing = a.charRange as CharRange;
  return Array.isArray(a.charRanges) && a.charRanges.length > 0 && a.charRanges.length <= 2000 &&
    a.charRanges.every((range, index, ranges) => validRange(range) && range.start >= enclosing.start && range.end <= enclosing.end &&
      (index === 0 || range.start >= ranges[index - 1].end));
}

humanAnnotationsRouter.post("/documents/:docId/human-annotations", requireAuth, async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.docId);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const { anchor, body, visibility, color } = req.body as {
      anchor?: unknown;
      body?: unknown;
      visibility?: Visibility;
      color?: unknown;
    };

    if (!isValidAnchor(anchor) || !validBody(body)) {
      res.status(400).json({ error: "anchor and a non-empty body are required" });
      return;
    }
    if (anchor.charRange.end > codePointLength(document.normalizedText)) {
      res.status(400).json({ error: "Selection falls outside the document text" });
      return;
    }
    if (visibility !== undefined && visibility !== "private" && visibility !== "org") {
      res.status(400).json({ error: "visibility must be 'private' or 'org'" });
      return;
    }
    if (color !== undefined && !isLensColor(color)) {
      res.status(400).json({ error: "Choose a preset annotation color" });
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
      color,
    });

    broadcastAnnotationsChanged(req.params.docId);
    res.status(201).json({ annotation: created });
  } catch (err) {
    next(err);
  }
});

humanAnnotationsRouter.patch("/documents/:docId/human-annotations/:id", requireAuth, async (req, res, next) => {
  try {
    const { body, version, color } = req.body as { body?: unknown; version?: unknown; color?: unknown };
    if (!validBody(body) || !validVersion(version)) {
      res.status(400).json({ error: "body (non-empty string) and version (number) are required" });
      return;
    }
    if (color !== undefined && !isLensColor(color)) {
      res.status(400).json({ error: "Choose a preset annotation color" });
      return;
    }

    const existing = await findHumanAnnotationById(req.params.id);
    if (!existing || existing.docId !== req.params.docId || existing.deletedAt || !(await visibleRoot(existing, req.user!.id))) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    if (existing.ai) { res.status(403).json({ error: "AI replies cannot be edited" }); return; }
    // Editing is always restricted to the comment author.
    if (existing.authorId !== req.user!.id) {
      res.status(403).json({ error: "You can only edit your own annotations" });
      return;
    }

    const result = await updateHumanAnnotationBody(req.params.id, version, body.trim(), color);
    if (!result.ok) {
      res.status(409).json({ error: "This annotation was already modified", current: result.current });
      return;
    }

    broadcastAnnotationsChanged(req.params.docId);
    if (existing.authorId) broadcastNotificationsChanged(existing.authorId);
    if (existing.parentId) { const recipient = await findNotificationRecipient(existing.id); if (recipient) broadcastNotificationsChanged(recipient); }
    for (const recipient of await findPaperCommentRecipients(existing.id)) broadcastNotificationsChanged(recipient);
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
    if (existing.authorId !== req.user!.id && req.user!.role !== "admin") {
      res.status(403).json({ error: "You can delete your own comments; admins may delete any comment" });
      return;
    }

    const result = await softDeleteHumanAnnotation(req.params.id, version, req.user!.id, req.user!.role);
    if (!result.ok) {
      res.status(409).json({ error: "This annotation was already modified", current: result.current });
      return;
    }

    if (existing.ai) await cancelAiReply(existing.id);

    broadcastAnnotationsChanged(req.params.docId);
    if (existing.authorId) broadcastNotificationsChanged(existing.authorId);
    if (existing.parentId) { const recipient = await findNotificationRecipient(existing.id); if (recipient) broadcastNotificationsChanged(recipient); }
    for (const recipient of await findPaperCommentRecipients(existing.id)) broadcastNotificationsChanged(recipient);
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
