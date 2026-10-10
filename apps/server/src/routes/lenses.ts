import { Router, type Router as RouterType } from "express";
import { v4 as uuid } from "uuid";
import type { LensSpec, User } from "@paper-xray/contracts";
import { requireAuth } from "../auth/middleware.js";
import { deleteLens, findLensById, insertLens, listLensesForUser, updateLens } from "../db/lens-repository.js";
import { findProvider } from "../db/providers.js";
import { validateLensDraft } from "../lenses/validate-draft.js";

export const lensesRouter: RouterType = Router();

/**
 * Who may edit a lens (docs/02-decisions.md #4): org lenses belong to
 * curators (admins too, as org settings owners); a personal lens only to
 * its owner.
 */
function canEdit(user: User, lens: Pick<LensSpec, "ownerId">): boolean {
  if (lens.ownerId === null) return user.role === "curator" || user.role === "admin";
  return lens.ownerId === user.id;
}

/** Org lenses plus the caller's own personal lenses, as full specs. */
lensesRouter.get("/lenses", requireAuth, async (req, res, next) => {
  try {
    res.json({ lenses: await listLensesForUser(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

/** Body: a LensDraft plus `org: true` to create an org lens (curator/admin only); otherwise it's a personal lens owned by the caller. */
lensesRouter.post("/lenses", requireAuth, async (req, res, next) => {
  try {
    const validated = validateLensDraft(req.body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const org = (req.body as { org?: unknown }).org === true;
    const ownerId = org ? null : req.user!.id;
    if (!canEdit(req.user!, { ownerId })) {
      res.status(403).json({ error: "Only curators can create org lenses" });
      return;
    }
    if (validated.draft.providerId) {
      const provider = await findProvider(validated.draft.providerId);
      if (!provider || (provider.ownerId !== null && (org || provider.ownerId !== req.user!.id))) {
        res.status(400).json({ error: "Provider or model is unavailable for this lens" }); return;
      }
    }
    const lens = await insertLens({ id: `${org ? "org" : "personal"}-${uuid()}`, ownerId, draft: validated.draft });
    res.status(201).json({ lens });
  } catch (err) {
    next(err);
  }
});

lensesRouter.put("/lenses/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await findLensById(req.params.id);
    if (!existing || (existing.ownerId !== null && existing.ownerId !== req.user!.id)) {
      res.status(404).json({ error: "Lens not found" });
      return;
    }
    if (!canEdit(req.user!, existing)) {
      res.status(403).json({ error: "Only curators can edit org lenses" });
      return;
    }
    const validated = validateLensDraft(req.body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    if (validated.draft.providerId) {
      const provider = await findProvider(validated.draft.providerId);
      if (!provider || (provider.ownerId !== null && (existing.ownerId === null || provider.ownerId !== req.user!.id))) {
        res.status(400).json({ error: "Provider or model is unavailable for this lens" }); return;
      }
    }
    res.json({ lens: await updateLens(existing, validated.draft) });
  } catch (err) {
    next(err);
  }
});

lensesRouter.delete("/lenses/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await findLensById(req.params.id);
    if (!existing || (existing.ownerId !== null && existing.ownerId !== req.user!.id)) {
      res.status(404).json({ error: "Lens not found" });
      return;
    }
    if (!canEdit(req.user!, existing)) {
      res.status(403).json({ error: "Only curators can delete org lenses" });
      return;
    }
    await deleteLens(existing.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
