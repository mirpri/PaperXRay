import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type Router as RouterType } from "express";
import type { Document } from "@paper-xray/contracts";
import multer from "multer";
import { config } from "../config.js";
import { extractPages } from "../extraction/extract-pages.js";
import { buildDocument } from "../reassembly/build-document.js";
import { runLensById } from "../lenses/run-all-lenses.js";
import { verifyAndFilterAgentAnnotations } from "../evidence/apply-verification.js";
import { requireAuth } from "../auth/middleware.js";
import { normalizePaperUrl } from "../import/normalize-url.js";
import { fetchPdf, ImportError } from "../import/safe-fetch.js";
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
  setAgentRunVisibility,
  findAgentRunOwner,
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

/**
 * Shared by upload and URL import: same bytes = same document, however or
 * whoever brought them in (docs/02-decisions.md #2).
 */
async function ingestPdf(bytes: Buffer, originalFilename: string): Promise<{ document: Document; deduped: boolean }> {
  const contentHash = createHash("sha256").update(bytes).digest("hex");

  const existing = await findDocumentByContentHash(contentHash);
  if (existing) return { document: existing, deduped: true };

  // pdfjs-dist rejects Node's Buffer (a Uint8Array subclass) outright; needs a plain Uint8Array.
  const pages = await extractPages(new Uint8Array(bytes));
  const { normalizedText, charMap, nodes } = buildDocument(pages, contentHash);
  const { document } = await createDocumentWithNodes({
    contentHash,
    originalFilename,
    pageCount: pages.length,
    normalizedText,
    charMap,
    nodes,
  });

  await mkdir(config.uploadsDir, { recursive: true });
  await writeFile(pdfPathForHash(contentHash), bytes);

  // Lenses don't run automatically on ingest — each lens is triggered on
  // demand from the reader (its filter chip shows dashed until then), see
  // POST /documents/:id/lenses/:lensId/run below.
  return { document, deduped: false };
}

documentsRouter.post("/documents", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }
    const { document, deduped } = await ingestPdf(req.file.buffer, req.file.originalname);
    res.status(deduped ? 200 : 201).json({ document, deduped });
  } catch (err) {
    next(err);
  }
});

/** Import by URL (docs/02-decisions.md #7): canonicalize (arXiv /abs/ vs /pdf/ etc.), then fetch under the SSRF policy in ../import/safe-fetch.ts. */
documentsRouter.post("/documents/import", requireAuth, async (req, res, next) => {
  try {
    const { url } = req.body as { url?: unknown };
    if (typeof url !== "string" || url.trim().length === 0) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    let bytes: Buffer;
    let suggestedFilename: string;
    try {
      const normalized = normalizePaperUrl(url);
      suggestedFilename = normalized.suggestedFilename;
      bytes = await fetchPdf(normalized.fetchUrl, config.urlImport);
    } catch (err) {
      if (err instanceof ImportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (err instanceof Error && err.message === "Not a valid URL") {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const { document, deduped } = await ingestPdf(bytes, suggestedFilename);
    res.status(deduped ? 200 : 201).json({ document, deduped });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents", requireAuth, async (_req, res, next) => {
  try {
    res.json({ documents: await listDocuments() });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/documents/:id", requireAuth, async (req, res, next) => {
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

documentsRouter.get("/documents/:id/charmap", requireAuth, async (req, res, next) => {
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

documentsRouter.get("/documents/:id/file", requireAuth, async (req, res, next) => {
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

documentsRouter.get("/documents/:id/nodes", requireAuth, async (req, res, next) => {
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

documentsRouter.get("/documents/:id/lens-runs", requireAuth, async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({ lensRuns: await listLensRunsForDocument(req.params.id, req.user!.id) });
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

documentsRouter.get("/documents/:id/annotations", requireAuth, async (req, res, next) => {
  try {
    const document = await findDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const [agentAnnotations, humanAnnotations] = await Promise.all([
      listAgentAnnotationsForDoc(req.params.id, req.user!.id),
      listHumanAnnotationsForDoc(req.params.id, req.user!.id),
    ]);
    res.json({ annotations: [...agentAnnotations, ...humanAnnotations] });
  } catch (err) {
    next(err);
  }
});

/**
 * Toggles one of the caller's own personal-lens runs between `private` and
 * `org` as a whole (docs/02-decisions.md #5: the run is the unit of
 * sharing). Org-lens runs have no owner and can't be toggled.
 */
documentsRouter.patch("/documents/:id/runs/:runId/visibility", requireAuth, async (req, res, next) => {
  try {
    const { visibility } = req.body as { visibility?: unknown };
    if (visibility !== "private" && visibility !== "org") {
      res.status(400).json({ error: "visibility must be 'private' or 'org'" });
      return;
    }
    const run = await findAgentRunOwner(req.params.runId);
    if (!run || run.docId !== req.params.id) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    if (run.ownerId !== req.user!.id) {
      res.status(403).json({ error: "Only the run's owner can change its visibility" });
      return;
    }
    await setAgentRunVisibility(req.params.runId, req.user!.id, visibility);
    broadcastAnnotationsChanged(req.params.id);
    res.json({ runId: req.params.runId, visibility });
  } catch (err) {
    next(err);
  }
});
