import { Router, type Router as RouterType } from "express";
import { requireAuth } from "../auth/middleware.js";
import { deleteProvider, findProvider, listProviders, ProviderConflict, saveProvider } from "../db/providers.js";
import { validateProvider } from "../lenses/validate-provider.js";
export const providersRouter: RouterType = Router();
providersRouter.use(requireAuth);
providersRouter.get("/providers", async (req, res, next) => {
  try { res.json({ providers: await listProviders(req.user!.id) }); } catch (err) { next(err); }
});
providersRouter.post("/providers", async (req, res, next) => {
  try {
    const org = req.body?.org === true;
    if (org && req.user!.role !== "admin") { res.status(403).json({ error: "Only admins manage organization providers" }); return; }
    const result = validateProvider(req.body);
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    if (!org && result.draft.apiKey != null) { res.status(400).json({ error: "Personal API keys must stay in your browser" }); return; }
    res.status(201).json({ provider: await saveProvider(null, org ? null : req.user!.id, result.draft) });
  } catch (err) { next(err); }
});
providersRouter.put("/providers/:id", async (req, res, next) => {
  try {
    const provider = await findProvider(req.params.id);
    if (!provider || (provider.ownerId !== null && provider.ownerId !== req.user!.id)) { res.status(404).json({ error: "Provider not found" }); return; }
    if (provider.ownerId === null && req.user!.role !== "admin") { res.status(403).json({ error: "Only admins manage organization providers" }); return; }
    const result = validateProvider(req.body);
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    if (provider.ownerId !== null && result.draft.apiKey != null) { res.status(400).json({ error: "Personal API keys must stay in your browser" }); return; }
    res.json({ provider: await saveProvider(provider.id, provider.ownerId, result.draft) });
  } catch (err) { if (err instanceof ProviderConflict) res.status(409).json({ error: err.message }); else next(err); }
});
providersRouter.delete("/providers/:id", async (req, res, next) => {
  try {
    const provider = await findProvider(req.params.id);
    if (!provider || (provider.ownerId !== null && provider.ownerId !== req.user!.id)) { res.status(404).json({ error: "Provider not found" }); return; }
    if (provider.ownerId === null && req.user!.role !== "admin") { res.status(403).json({ error: "Only admins manage organization providers" }); return; }
    await deleteProvider(provider.id); res.status(204).end();
  } catch (err) { if (err instanceof ProviderConflict) res.status(409).json({ error: err.message }); else next(err); }
});
