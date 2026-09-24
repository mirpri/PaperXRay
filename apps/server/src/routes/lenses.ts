import { Router, type Router as RouterType } from "express";
import { PRESET_LENSES } from "../lenses/presets.js";
import { requireAuth } from "../auth/middleware.js";

export const lensesRouter: RouterType = Router();

/** Lets the frontend list the on-demand lens chips without hardcoding/duplicating apps/server/src/lenses/presets.ts. */
lensesRouter.get("/lenses", requireAuth, (_req, res) => {
  res.json({
    lenses: PRESET_LENSES.map((spec) => ({ id: spec.id, name: spec.name, description: spec.description })),
  });
});
