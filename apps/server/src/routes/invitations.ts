import { Router, type Request, type Response, type Router as RouterType } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import {
  createInvitation,
  listInvitations,
  deleteInvitation,
  getRegistrationMode,
  setRegistrationMode,
  getInvitationByCode,
  type RegistrationMode,
} from "../db/invitation-repository.js";

export const invitationsRouter: RouterType = Router();

// Get all invitations (admin only)
invitationsRouter.get(
  "/admin/invitations",
  requireRole("admin"),
  async (_req: Request, res: Response, next) => {
    try {
      const invitations = await listInvitations();
      const apiInvitations = invitations.map(inv => ({
        id: inv.id,
        code: inv.code,
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expires_at ? inv.expires_at.toISOString() : null,
        usedAt: inv.used_at ? inv.used_at.toISOString() : null,
        usedBy: inv.used_by,
        usedByName: inv.used_by_name,
        createdAt: inv.created_at.toISOString(),
      }));
      res.json(apiInvitations);
    } catch (error) {
      next(error);
    }
  }
);

// Create a new invitation (admin only)
invitationsRouter.post(
  "/admin/invitations",
  requireRole("admin"),
  async (req: Request, res: Response, next) => {
    try {
      const { email, role, expiresInDays } = req.body;
      
      if (!role || !["member", "curator", "admin"].includes(role)) {
        res.status(400).json({ error: "Invalid role" });
        return;
      }

      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const invitation = await createInvitation(
        req.user!.id,
        email || null,
        role,
        expiresAt
      );

      res.status(201).json({
        id: invitation.id,
        code: invitation.code,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expires_at ? invitation.expires_at.toISOString() : null,
        usedAt: invitation.used_at ? invitation.used_at.toISOString() : null,
        usedBy: invitation.used_by,
        createdAt: invitation.created_at.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete an invitation (admin only)
invitationsRouter.delete(
  "/admin/invitations/:id",
  requireRole("admin"),
  async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params;
      const deleted = await deleteInvitation(id);
      
      if (!deleted) {
        res.status(404).json({ error: "Invitation not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Get registration mode (admin only)
invitationsRouter.get(
  "/admin/registration-mode",
  requireRole("admin"),
  async (_req: Request, res: Response, next) => {
    try {
      const mode = await getRegistrationMode();
      res.json({ mode });
    } catch (error) {
      next(error);
    }
  }
);

// Validate invitation code (public endpoint - no authentication required)
invitationsRouter.get(
  "/public/invitations/validate/:code",
  async (req: Request, res: Response, next) => {
    try {
      const { code } = req.params;
      const invitation = await getInvitationByCode(code);
      
      if (!invitation) {
        res.status(404).json({ valid: false, error: "Invitation not found" });
        return;
      }
      
      if (invitation.used_at) {
        res.status(400).json({ valid: false, error: "Invitation already used" });
        return;
      }
      
      if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
        res.status(400).json({ valid: false, error: "Invitation expired" });
        return;
      }
      
      res.json({ 
        valid: true, 
        role: invitation.role,
        email: invitation.email 
      });
    } catch (error) {
      next(error);
    }
  }
);

// Set registration mode (admin only)
invitationsRouter.put(
  "/admin/registration-mode",
  requireRole("admin"),
  async (req: Request, res: Response, next) => {
    try {
      const { mode } = req.body;
      
      if (!mode || !["invite_only", "approval_required", "open"].includes(mode)) {
        res.status(400).json({ error: "Invalid registration mode" });
        return;
      }

      await setRegistrationMode(mode as RegistrationMode);
      res.json({ mode });
    } catch (error) {
      next(error);
    }
  }
);
