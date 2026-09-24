import { Router, type Router as RouterType } from "express";
import { config } from "../config.js";
import { getSsoConfig, upsertUserFromSso } from "../db/repositories.js";
import { codeChallengeFromVerifier, generateCodeVerifier, generateState } from "../auth/pkce.js";
import { OAUTH_STATE_COOKIE_NAME, readAndClearOAuthStateCookie, setOAuthStateCookie } from "../auth/oauth-state.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";

export const authRouter: RouterType = Router();

/**
 * Standard OAuth2 Authorization Code + PKCE (docs/02-decisions.md #11).
 * Works against any IdP that speaks this protocol; the endpoints/clientId
 * come from the admin-configurable sso_config row (defaults to mirpass).
 */
authRouter.get("/auth/login", async (_req, res, next) => {
  try {
    const sso = await getSsoConfig();
    if (!sso.clientId) {
      res.status(500).json({ error: "SSO is not configured (empty clientId) — set it in the admin panel" });
      return;
    }

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    setOAuthStateCookie(res, state, codeVerifier);

    const url = new URL(sso.authorizationEndpoint);
    url.searchParams.set("client_id", sso.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", config.sso.mirpassRedirectUri);
    url.searchParams.set("state", state);
    // Confidential-client flow (we have a trusted backend + client_secret) skips
    // PKCE entirely per the mirpass guide — "If you cannot use PKCE, you can
    // omit code_challenge and instead provide client_secret". Using one or the
    // other (not both) avoids a class of bugs where a stale/duplicate login
    // attempt's verifier cookie gets out of sync with the challenge actually
    // used to obtain the code.
    if (!sso.clientSecret) {
      const codeChallenge = codeChallengeFromVerifier(codeVerifier);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    if (sso.scopes) url.searchParams.set("scope", sso.scopes);

    res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
});

authRouter.get("/auth/callback", async (req, res, next) => {
  try {
    const { code, state: returnedState, error } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    const saved = readAndClearOAuthStateCookie(
      req.cookies?.[OAUTH_STATE_COOKIE_NAME] as string | undefined,
    );
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: "/api/auth" });

    if (error) {
      res.redirect(`${config.webOrigin}/?login_error=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !returnedState || !saved || saved.state !== returnedState) {
      res.status(400).json({ error: "Invalid or expired login attempt (state mismatch)" });
      return;
    }

    const sso = await getSsoConfig();

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: sso.clientId,
      code,
      redirect_uri: config.sso.mirpassRedirectUri,
    });
    if (sso.clientSecret) {
      tokenBody.set("client_secret", sso.clientSecret);
    } else {
      tokenBody.set("code_verifier", saved.codeVerifier);
    }

    const tokenRes = await fetch(sso.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error(`mirpass token exchange failed (${tokenRes.status}):`, body);
      res.status(502).json({ error: `Token exchange failed: ${tokenRes.status}`, mirpassResponse: body });
      return;
    }
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

    const userinfoRes = await fetch(sso.userinfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userinfoRes.ok) {
      res.status(502).json({ error: `Fetching user info failed: ${userinfoRes.status}` });
      return;
    }
    const profile = (await userinfoRes.json()) as {
      sub: string;
      email?: string;
      preferred_username?: string;
      nickname?: string;
    };

    const email = profile.email ?? `${profile.sub}@sso.local`;
    const displayName = profile.nickname ?? profile.preferred_username ?? profile.sub;
    const isBootstrapAdmin = config.sso.adminEmails.includes(email.toLowerCase());

    const user = await upsertUserFromSso({
      ssoSub: profile.sub,
      email,
      displayName,
      isBootstrapAdmin,
    });

    setSessionCookie(res, user.id);
    res.redirect(config.webOrigin);
  } catch (err) {
    next(err);
  }
});

authRouter.get("/auth/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  res.json({ user: req.user });
});

authRouter.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});
