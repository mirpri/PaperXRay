import type { Response } from "express";
import { config } from "../config.js";
import { sign, verify } from "./signed-value.js";

/**
 * Carries `state` + PKCE `code_verifier` across the redirect round-trip to
 * the IdP and back. A signed, httpOnly, short-lived cookie rather than
 * server-side memory — stateless across restarts/multiple server instances,
 * and signing prevents a tampered cookie from smuggling a verifier that
 * doesn't match the challenge we sent.
 */
const OAUTH_STATE_COOKIE_NAME = "pxr_oauth";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — just long enough for a login round-trip

export function setOAuthStateCookie(res: Response, state: string, codeVerifier: string): void {
  const payload = `${state}:${codeVerifier}`;
  res.cookie(OAUTH_STATE_COOKIE_NAME, sign(payload, config.session.secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.webOrigin.startsWith("https://"),
    maxAge: OAUTH_STATE_MAX_AGE_MS,
    path: "/api/auth",
  });
}

export function readAndClearOAuthStateCookie(
  cookieValue: string | undefined,
): { state: string; codeVerifier: string } | null {
  const payload = verify(cookieValue, config.session.secret);
  if (!payload) return null;
  const colon = payload.indexOf(":");
  if (colon === -1) return null;
  return { state: payload.slice(0, colon), codeVerifier: payload.slice(colon + 1) };
}

export { OAUTH_STATE_COOKIE_NAME };
