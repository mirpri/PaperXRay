import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type Router as RouterType } from "express";
import multer from "multer";
import { config } from "../config.js";
import { extractPages } from "../extraction/extract-pages.js";
import { buildDocument } from "../reassembly/build-document.js";
import { runLensById } from "../lenses/run-all-lenses.js";
import { verifyAndFilterAgentAnnotations } from "../evidence/apply-verification.js";
import { requireAuth } from "../auth/middleware.js";
import {
  createDocumentWithNodes,
  findDocumentByContentHash,
  findDocumentById,
  getCharMapForDocument,
  insertAgentAnnotations,
  listAgentAnnotationsForDoc,
  listDocuments,
  listHumanAnnotationsForDoc,
  listLensRunsForDocument,
  listNodesForDocument,
  recordLensRun,
} from "../db/repositories.js";
import { broadcastAnnotationsChanged } from "../realtime/socket.js";

function pdfPathForHash(contentHash: string): string {
  return path.join(config.uploadsDir, `${contentHash}.pdf`);
}

export const documentsRouter: RouterType = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only application/pdf uploads are accepted"));
      return;
    }
    cb(null, true);
  },
});

documentsRouter.post("/documents", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }

    const contentHash = createHash("sha256").update(req.file.buffer).digest("hex");

    // Same PDF bytes = same document, however/whoever uploaded it (docs/02-decisions.md #2).
    const existing = await findDocumentByContentHash(contentHash);
    if (existing) {
      res.status(200).json({ document: existing, deduped: true });
      return;
    }

    // pdfjs-dist rejects Node's Buffer (a Uint8Array subclass) outright; needs a plain Uint8Array.
    const pages = await extractPages(new Uint8Array(req.file.buffer));
    const { normalizedText, charMap, nodes } = buildDocument(pages, contentHash);
    const { document } = await createDocumentWithNodes({
      contentHash,
      originalFilename: req.file.originalname,
      pageCount: pages.length,
      normalizedText,
      charMap,
      nodes,
    });

    await mkdir(config.uploadsDir, { recursive: true });
    await writeFile(pdfPathForHash(contentHash), req.file.buffer);

    // Lenses no longer run automatically on upload — each preset lens is
    // triggered on demand from the reader (its filter chip shows dashed
    // until then), see POST /documents/:id/lenses/:lensId/run below.

    res.status(201).json({ document, deduped: false });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents", async (_req, res, next) => {
  try {
    res.json({ documents: await listDocuments() });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents/:id", async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({ document });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents/:id/charmap", async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const charMap = await getCharMapForDocument(req.params.id);
    res.json({ charMap: charMap ?? [] });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents/:id/file", async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const bytes = await readFile(pdfPathForHash(document.contentHash));
    res.setHeader("Content-Type", "application/pdf");
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents/:id/nodes", async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({ nodes: await listNodesForDocument(req.params.id) });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents/:id/lens-runs", async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({ lensRuns: await listLensRunsForDocument(req.params.id) });
  } catch (err) {
    next(err);
  }
});

documentsRouter.post("/documents/:id/lenses/:lensId/run", requireAuth, async (req, res, next) => {
  console.log(`POST /documents/${req.params.id}/lenses/${req.params.lensId}/run (user ${req.user?.id})`);
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const nodes = await listNodesForDocument(req.params.id);
    if (nodes.length === 0) {
      await recordLensRun(document.id, req.params.lensId, 0);
      res.status(202).json({ producedCount: 0 });
      return;
    }

    let candidates;
    try {
      candidates = await runLensById({
        lensId: req.params.lensId,
        docId: document.id,
        normalizedText: document.normalizedText,
        nodes,
      });
    } catch (err) {
      console.error(`Lens run failed (doc ${document.id}, lens ${req.params.lensId}):`, err);
      res.status(400).json({ error: err instanceof Error ? err.message : "Unknown lens id" });
      return;
    }

    // Server-side re-verification per docs/02-decisions.md #6 — never trust
    // a lens's own evidenceSpan, client- or server-executed.
    const verified = verifyAndFilterAgentAnnotations({
      candidates,
      normalizedText: document.normalizedText,
      nodes,
      scope: "all",
    });
    await insertAgentAnnotations(verified);
    // Recorded even when verified.length is 0 — a lens that ran and found
    // nothing is a different fact from one that was never triggered, and
    // the frontend's filter chips (dashed vs. solid) need to tell those
    // apart rather than inferring "has run" from annotation count.
    await recordLensRun(document.id, req.params.lensId, verified.length);
    broadcastAnnotationsChanged(document.id);

    console.log(`Lens run done (doc ${document.id}, lens ${req.params.lensId}): ${verified.length} annotation(s)`);
    res.status(202).json({ producedCount: verified.length });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents/:id/annotations", async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const [agentAnnotations, humanAnnotations] = await Promise.all([
      listAgentAnnotationsForDoc(req.params.id),
      listHumanAnnotationsForDoc(req.params.id),
    ]);
    res.json({ annotations: [...agentAnnotations, ...humanAnnotations] });
  } catch (err) {
    next(err);
  }
});
