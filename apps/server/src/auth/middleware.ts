import type { NextFunction, Request, Response } from "express";
import type { Role, User } from "@paper-xray/contracts";
import { config } from "../config.js";
import { findUserById } from "../db/repositories.js";
import { SESSION_COOKIE_NAME } from "./session.js";
import { verify } from "./signed-value.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Reads and verifies the session cookie, attaching req.user if valid. Never rejects — routes that need a logged-in user use requireAuth below. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const raw = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  const userId = verify(raw, config.session.secret);
  if (userId) {
    req.user = (await findUserById(userId)) ?? undefined;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  if (req.user.status === "pending") {
    res.status(403).json({ error: "Membership is pending administrator approval", code: "membership_pending" });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Login required" });
      return;
    }
    if (req.user.status === "pending" || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}
