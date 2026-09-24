import { Router, type Router as RouterType } from "express";
import { requireRole } from "../auth/middleware.js";
import { getSsoConfigPublic, updateSsoConfig } from "../db/repositories.js";

export const adminRouter: RouterType = Router();

/**
 * Admin-panel SSO settings (docs/02-decisions.md #11): lets an admin point
 * the whole app at a different standard OAuth2 IdP, or rotate mirpass
 * credentials, without a redeploy. clientSecret is write-only — GET never
 * returns it, only whether one is set.
 */
adminRouter.get("/admin/sso-config", requireRole("admin"), async (_req, res, next) => {
  try {
    res.json({ ssoConfig: await getSsoConfigPublic() });
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/admin/sso-config", requireRole("admin"), async (req, res, next) => {
  try {
    const {
      providerName,
      authorizationEndpoint,
      tokenEndpoint,
      userinfoEndpoint,
      clientId,
      clientSecret,
      scopes,
    } = req.body as {
      providerName?: unknown;
      authorizationEndpoint?: unknown;
      tokenEndpoint?: unknown;
      userinfoEndpoint?: unknown;
      clientId?: unknown;
      clientSecret?: unknown;
      scopes?: unknown;
    };

    if (
      typeof providerName !== "string" ||
      typeof authorizationEndpoint !== "string" ||
      typeof tokenEndpoint !== "string" ||
      typeof userinfoEndpoint !== "string" ||
      typeof clientId !== "string" ||
      typeof scopes !== "string"
    ) {
      res.status(400).json({
        error: "providerName, authorizationEndpoint, tokenEndpoint, userinfoEndpoint, clientId, scopes are required strings",
      });
      return;
    }
    if (clientSecret !== undefined && clientSecret !== null && typeof clientSecret !== "string") {
      res.status(400).json({ error: "clientSecret must be a string, null (to clear), or omitted (to leave unchanged)" });
      return;
    }

    const updated = await updateSsoConfig({
      providerName,
      authorizationEndpoint,
      tokenEndpoint,
      userinfoEndpoint,
      clientId,
      clientSecret: clientSecret as string | null | undefined,
      scopes,
    });
    res.json({ ssoConfig: updated });
  } catch (err) {
    next(err);
  }
});
