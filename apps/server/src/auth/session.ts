import type { Response } from "express";
import { config } from "../config.js";
import { sign } from "./signed-value.js";

export const SESSION_COOKIE_NAME = "pxr_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function setSessionCookie(res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE_NAME, sign(userId, config.session.secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.webOrigin.startsWith("https://"),
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}
