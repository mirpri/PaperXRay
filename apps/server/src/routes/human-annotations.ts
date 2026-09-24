import { Router, type Router as RouterType } from "express";
import type { Anchor, Visibility } from "@paper-xray/contracts";
import {
  findDocumentById,
  findHumanAnnotationById,
  insertHumanAnnotation,
  softDeleteHumanAnnotation,
  updateHumanAnnotationBody,
} from "../db/repositories.js";
import { requireAuth } from "../auth/middleware.js";
import { broadcastAnnotationsChanged } from "../realtime/socket.js";

export const humanAnnotationsRouter: RouterType = Router();

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

    if (!isValidAnchor(anchor) || typeof body !== "string" || body.trim().length === 0) {
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
      body,
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
    if (typeof body !== "string" || body.trim().length === 0 || typeof version !== "number") {
      res.status(400).json({ error: "body (non-empty string) and version (number) are required" });
      return;
    }

    const existing = await findHumanAnnotationById(req.params.id);
    if (!existing || existing.docId !== req.params.docId || existing.deletedAt) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    // Members read/write their own annotations only (docs/02-decisions.md #4) — no admin/curator override for someone else's annotation.
    if (existing.authorId !== req.user!.id) {
      res.status(403).json({ error: "You can only edit your own annotations" });
      return;
    }

    const result = await updateHumanAnnotationBody(req.params.id, version, body);
    if (!result.ok) {
      res.status(409).json({ error: "This annotation was already modified", current: result.current });
      return;
    }

    broadcastAnnotationsChanged(req.params.docId);
    res.json({ annotation: result.current });
  } catch (err) {
    next(err);
  }
});

humanAnnotationsRouter.delete("/documents/:docId/human-annotations/:id", requireAuth, async (req, res, next) => {
  try {
    const version = Number(req.query.version);
    if (!Number.isFinite(version)) {
      res.status(400).json({ error: "?version=<number> query param is required" });
      return;
    }

    const existing = await findHumanAnnotationById(req.params.id);
    if (!existing || existing.docId !== req.params.docId || existing.deletedAt) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    if (existing.authorId !== req.user!.id) {
      res.status(403).json({ error: "You can only delete your own annotations" });
      return;
    }

    const result = await softDeleteHumanAnnotation(req.params.id, version);
    if (!result.ok) {
      res.status(409).json({ error: "This annotation was already modified", current: result.current });
      return;
    }

    broadcastAnnotationsChanged(req.params.docId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
