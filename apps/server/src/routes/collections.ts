import { Router, type Router as RouterType } from "express";
import { requireAuth } from "../auth/middleware.js";
import {
  addCollectionDocument, createCollection, deleteCollection, getCollection, leaveCollection, listCollectionDocuments,
  listCollectionMembers, listCollectionUserOptions, listCollections, removeCollectionDocument,
  replaceCollectionMembers, updateCollection,
} from "../db/collection-repository.js";
import { parseDocumentListQuery } from "./document-list-query.js";
import { config } from "../config.js";
import { normalizePaperUrl } from "../import/normalize-url.js";
import { fetchPdf, ImportError } from "../import/safe-fetch.js";
import { ingestPdf } from "./documents.js";
import { broadcastNotificationsChanged } from "../realtime/socket.js";

export const collectionsRouter: RouterType = Router();

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value.trim()).length <= 120;
}

function validDescription(value: unknown): value is string {
  return value === undefined || (typeof value === "string" && Array.from(value.trim()).length <= 500);
}

collectionsRouter.get("/collections", requireAuth, async (req, res, next) => {
  try { res.json({ collections: await listCollections(req.user!.id) }); }
  catch (err) { next(err); }
});

collectionsRouter.post("/collections", requireAuth, async (req, res, next) => {
  const { name, description } = req.body ?? {};
  if (!validName(name) || !validDescription(description)) {
    res.status(400).json({ error: "name is required (1–120 characters); description may contain up to 500 characters" }); return;
  }
  try {
    const collection = await createCollection(req.user!.id, name.trim(), typeof description === "string" ? description.trim() : "");
    res.status(201).json({ collection });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "You already have a collection with this name" }); return;
    }
    next(err);
  }
});

// User options are returned only to the owner while the share editor is open.
collectionsRouter.get("/collections/:id/users", requireAuth, async (req, res, next) => {
  try {
    const collection = await getCollection(req.params.id, req.user!.id);
    if (!collection?.isOwner) { res.status(404).json({ error: "Collection not found" }); return; }
    res.json({ users: await listCollectionUserOptions(req.user!.id) });
  }
  catch (err) { next(err); }
});

collectionsRouter.get("/collections/:id", requireAuth, async (req, res, next) => {
  let query;
  try { query = parseDocumentListQuery(req.query); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Invalid collection query" }); return; }
  try {
    const page = await listCollectionDocuments(req.params.id, req.user!.id, query);
    if (!page) { res.status(404).json({ error: "Collection not found" }); return; }
    const collection = await getCollection(req.params.id, req.user!.id);
    if (!collection) { res.status(404).json({ error: "Collection not found" }); return; }
    const members = collection.isOwner ? await listCollectionMembers(req.params.id, req.user!.id) : null;
    res.json({ collection, documentsPage: page, members });
  } catch (err) { next(err); }
});

collectionsRouter.put("/collections/:id", requireAuth, async (req, res, next) => {
  const { name, description } = req.body ?? {};
  if (!validName(name) || !validDescription(description)) {
    res.status(400).json({ error: "name is required (1–120 characters); description may contain up to 500 characters" }); return;
  }
  try {
    const result = await updateCollection(req.params.id, req.user!.id, name.trim(), typeof description === "string" ? description.trim() : "");
    if (result === "not-found") { res.status(404).json({ error: "Collection not found" }); return; }
    if (result === "duplicate") { res.status(409).json({ error: "You already have a collection with this name" }); return; }
    const collection = await getCollection(req.params.id, req.user!.id);
    res.json({ collection });
  } catch (err) { next(err); }
});

collectionsRouter.delete("/collections/:id", requireAuth, async (req, res, next) => {
  try {
    if (!await deleteCollection(req.params.id, req.user!.id)) { res.status(404).json({ error: "Collection not found" }); return; }
    res.status(204).end();
  } catch (err) { next(err); }
});

collectionsRouter.put("/collections/:id/members", requireAuth, async (req, res, next) => {
  const userIds: unknown = req.body?.userIds;
  if (!Array.isArray(userIds) || userIds.length > 200 || !userIds.every(id => typeof id === "string")
    || new Set(userIds).size !== userIds.length) {
    res.status(400).json({ error: "userIds must be a unique list of at most 200 user IDs" }); return;
  }
  try {
    const result = await replaceCollectionMembers(req.params.id, req.user!.id, userIds as string[]);
    if (result === "not-found") { res.status(404).json({ error: "Collection not found" }); return; }
    if (result === "invalid-user") { res.status(400).json({ error: "Choose existing users other than yourself" }); return; }
    for (const userId of result.added) broadcastNotificationsChanged(userId);
    res.json({ members: await listCollectionMembers(req.params.id, req.user!.id) });
  } catch (err) { next(err); }
});

collectionsRouter.delete("/collections/:id/membership/me", requireAuth, async (req, res, next) => {
  try {
    const ownerId = await leaveCollection(req.params.id, req.user!.id);
    if (!ownerId) { res.status(404).json({ error: "Shared collection not found" }); return; }
    broadcastNotificationsChanged(ownerId);
    res.status(204).end();
  } catch (err) { next(err); }
});

collectionsRouter.post("/collections/:id/documents", requireAuth, async (req, res, next) => {
  const docId = req.body?.docId;
  if (typeof docId !== "string" || !docId) { res.status(400).json({ error: "docId is required" }); return; }
  try {
    const result = await addCollectionDocument(req.params.id, req.user!.id, docId);
    if (result === "not-found") { res.status(404).json({ error: "Collection or document not found" }); return; }
    res.status(result === "added" ? 201 : 200).json({ added: result === "added" });
  } catch (err) { next(err); }
});

collectionsRouter.delete("/collections/:id/documents/:docId", requireAuth, async (req, res, next) => {
  try {
    const result = await removeCollectionDocument(req.params.id, req.user!.id, req.params.docId);
    if (result === "not-found") { res.status(404).json({ error: "Collection not found" }); return; }
    res.status(204).end();
  } catch (err) { next(err); }
});

collectionsRouter.post("/collections/:id/import", requireAuth, async (req, res, next) => {
  const url = req.body?.url;
  if (typeof url !== "string" || !url.trim()) { res.status(400).json({ error: "url is required" }); return; }
  try {
    if (!await getCollection(req.params.id, req.user!.id)) { res.status(404).json({ error: "Collection not found" }); return; }
    let normalized;
    try { normalized = normalizePaperUrl(url); }
    catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Not a valid URL" }); return; }
    let bytes: Buffer;
    try { bytes = await fetchPdf(normalized.fetchUrl, config.urlImport); }
    catch (err) {
      if (err instanceof ImportError) { res.status(err.status).json({ error: err.message }); return; }
      throw err;
    }
    const { document, deduped } = await ingestPdf(bytes, normalized.suggestedFilename);
    const added = await addCollectionDocument(req.params.id, req.user!.id, document.id);
    if (added === "not-found") { res.status(409).json({ error: "The paper is in the organization library, but collection access changed before it could be added" }); return; }
    res.status(deduped && added === "exists" ? 200 : 201).json({ document, deduped, added: added === "added" });
  } catch (err) { next(err); }
});
