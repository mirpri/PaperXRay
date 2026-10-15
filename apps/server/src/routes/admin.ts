import { Router, type Router as RouterType } from "express";
import { requireRole } from "../auth/middleware.js";
import type { Role } from "@paper-xray/contracts";
import { approveMembership, deleteUserAccount, getSsoConfig, getSsoConfigPublic, getUserDeletionPreview, listUsers, setUserRole, updateSsoConfig } from "../db/repositories.js";
import { broadcastNotificationsChanged, disconnectDeletedUser } from "../realtime/socket.js";
import { listProviders, saveProvider, ProviderConflict } from "../db/providers.js";
import { validateProvider } from "../lenses/validate-provider.js";


const ROLES: readonly Role[] = ["admin", "curator", "member"];

export const adminRouter: RouterType = Router();

adminRouter.get("/admin/users/:id/deletion-preview", requireRole("admin"), async (req, res, next) => {
  try {
    if (req.params.id === req.user!.id) { res.status(400).json({ error: "You cannot delete your own account" }); return; }
    const preview = await getUserDeletionPreview(req.params.id);
    if (!preview) { res.status(404).json({ error: "User not found" }); return; }
    res.json(preview);
  } catch (err) { next(err); }
});

adminRouter.delete("/admin/users/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await deleteUserAccount(req.user!.id, req.params.id);
    if (result === "not-found") { res.status(404).json({ error: "User not found" }); return; }
    if (result === "self") { res.status(400).json({ error: "You cannot delete your own account" }); return; }
    if (result === "last-admin") { res.status(409).json({ error: "Cannot delete the last active administrator" }); return; }
    disconnectDeletedUser(req.params.id);
    for (const admin of await listUsers()) if (admin.role === "admin" && admin.status !== "pending") broadcastNotificationsChanged(admin.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

adminRouter.post("/admin/users/:id/approve", requireRole("admin"), async (req, res, next) => {
  try {
    const user = await approveMembership(req.params.id);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    for (const admin of await listUsers()) if (admin.role === "admin" && admin.status !== "pending") broadcastNotificationsChanged(admin.id);
    res.json({ user });
  } catch (err) { next(err); }
});

/**
 * Admin-panel SSO settings (docs/02-decisions.md #11): lets an admin point
 * the whole app at a different standard OAuth2 IdP, or rotate mirpass
 * credentials, without a redeploy. Regular settings reads redact clientSecret;
 * the explicit admin export includes credentials for backup and transfer.
 */
adminRouter.get("/admin/sso-config", requireRole("admin"), async (_req, res, next) => {
  try {
    res.json({ ssoConfig: await getSsoConfigPublic() });
  } catch (err) {
    next(err);
  }
});

/** Explicit backup download, separate from the redacted settings endpoint. */
adminRouter.get("/admin/sso-config/export", requireRole("admin"), async (_req, res, next) => {
  try {
    const settings = await getSsoConfig();
    res.set("Cache-Control", "no-store")
      .set("Content-Disposition", 'attachment; filename="sso-config.json"')
      .type("application/json")
      .send(JSON.stringify(settings, null, 2) + "\n");
  } catch (err) { next(err); }
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
      accountManagementUrl,
    } = req.body as {
      providerName?: unknown;
      authorizationEndpoint?: unknown;
      tokenEndpoint?: unknown;
      userinfoEndpoint?: unknown;
      clientId?: unknown;
      clientSecret?: unknown;
      scopes?: unknown;
      accountManagementUrl?: unknown;
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

    if (accountManagementUrl !== undefined && accountManagementUrl !== null && typeof accountManagementUrl !== "string") {
      res.status(400).json({ error: "accountManagementUrl must be a string, null, or omitted" }); return;
    }
    const accountUrl = typeof accountManagementUrl === "string" ? accountManagementUrl.trim() || null : accountManagementUrl;
    if (accountUrl) {
      try {
        const parsed = new URL(accountUrl);
        if (accountUrl.length > 512 || !["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid URL");
      } catch {
        res.status(400).json({ error: "accountManagementUrl must be an absolute HTTP or HTTPS URL (up to 512 characters)" }); return;
      }
    }

    const updated = await updateSsoConfig({
      providerName,
      authorizationEndpoint,
      tokenEndpoint,
      userinfoEndpoint,
      clientId,
      clientSecret: clientSecret as string | null | undefined,
      accountManagementUrl: accountUrl,
      scopes,
    });
    res.json({ ssoConfig: updated });
  } catch (err) {
    next(err);
  }
});

/** User and role management (docs/02-decisions.md #4). SSO only supplies identity; roles live here. */
adminRouter.get("/admin/users", requireRole("admin"), async (_req, res, next) => {
  try {
    res.json({ users: await listUsers() });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/admin/users/:id/role", requireRole("admin"), async (req, res, next) => {
  try {
    const { role } = req.body as { role?: unknown };
    if (!ROLES.includes(role as Role)) {
      res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
      return;
    }
    const result = await setUserRole(req.params.id, role as Role);
    if (!result.ok) {
      if (result.reason === "not-found") res.status(404).json({ error: "User not found" });
      else res.status(409).json({ error: "Can't remove the last admin — promote someone else first" });
      return;
    }
    res.json({ user: result.user });
  } catch (err) {
    next(err);
  }
});

/** Export all organization providers (including API keys) for backup/transfer. */
adminRouter.get("/admin/providers/export", requireRole("admin"), async (_req, res, next) => {
  try {
    const all = await listProviders(null);
    const orgProviders = all.filter((p) => p.ownerId === null);
    // Fetch raw API keys for export
    const { pool } = await import("../db/pool.js");
    const ids = orgProviders.map((p) => p.id);
    if (ids.length === 0) {
      res.set("Cache-Control", "no-store")
        .set("Content-Disposition", 'attachment; filename="providers.json"')
        .type("application/json")
        .send(JSON.stringify({ providers: [] }, null, 2) + "\n");
      return;
    }
    const [rows] = await pool.query<any[]>(
      `SELECT id, api_key FROM providers WHERE id IN (?) AND deleted_at IS NULL`,
      [ids]
    );
    const keyMap = new Map(rows.map((r) => [r.id, r.api_key ?? null]));
    const exportData = orgProviders.map((p) => ({
      name: p.name,
      baseUrl: p.baseUrl,
      models: p.models,
      apiKey: keyMap.get(p.id) ?? null,
    }));
    res.set("Cache-Control", "no-store")
      .set("Content-Disposition", 'attachment; filename="providers.json"')
      .type("application/json")
      .send(JSON.stringify({ providers: exportData }, null, 2) + "\n");
  } catch (err) {
    next(err);
  }
});

/** Import organization providers (replaces existing org providers). */
adminRouter.post("/admin/providers/import", requireRole("admin"), async (req, res, next) => {
  try {
    const { providers } = req.body as { providers?: unknown };
    if (!Array.isArray(providers)) {
      res.status(400).json({ error: "providers must be an array" });
      return;
    }
    // Validate all items first
    const drafts: Array<{ name: string; baseUrl: string; models: string[]; apiKey?: string | null }> = [];
    for (let i = 0; i < providers.length; i++) {
      const item = providers[i];
      if (!item || typeof item !== "object") {
        res.status(400).json({ error: `providers[${i}] must be an object` });
        return;
      }
      const result = validateProvider({ ...item, org: true });
      if (!result.ok) {
        res.status(400).json({ error: `providers[${i}]: ${result.error}` });
        return;
      }
      drafts.push({ ...result.draft, apiKey: item.apiKey ?? null });
    }
    // Delete existing org providers
    const existing = await listProviders(null);
    const orgExisting = existing.filter((p) => p.ownerId === null);
    for (const p of orgExisting) {
      try {
        const { deleteProvider } = await import("../db/providers.js");
        await deleteProvider(p.id);
      } catch (err) {
        if (err instanceof ProviderConflict) {
          res.status(409).json({ error: `Cannot delete provider "${p.name}": ${err.message}` });
          return;
        }
        throw err;
      }
    }
    // Save new providers
    const saved = [];
    for (const draft of drafts) {
      const provider = await saveProvider(null, null, draft);
      saved.push(provider);
    }
    res.json({ providers: saved });
  } catch (err) {
    next(err);
  }
});
