import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Generic HMAC-signed string codec used for both the session cookie and the
 * short-lived OAuth state/PKCE-verifier cookie. Deliberately not a JWT —
 * there's nothing here that needs standardized claims, expiry is enforced by
 * cookie maxAge, and this keeps the auth code free of a JWT dependency.
 */
export function sign(payload: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verify(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;

  const payload = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expectedMac = sign(payload, secret).slice(payload.length + 1);

  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return payload;
}
