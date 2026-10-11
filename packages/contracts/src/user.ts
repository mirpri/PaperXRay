/**
 * User + roles (docs/02-decisions.md #4, #11). SSO (mirpass or any
 * admin-configured standard OAuth2 IdP) provides identity only — role is
 * always assigned and stored by this system, never taken from the IdP.
 */
export type Role = "admin" | "curator" | "member";

export interface User {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  status?: "pending" | "active";
}

/**
 * Org-wide SSO configuration (docs/02-decisions.md #11). Admin-editable;
 * defaults to mirpass. `clientSecret` is intentionally never included here —
 * it's write-only from the admin panel's point of view, same treatment as an
 * API key.
 */
export interface SsoConfigPublic {
  providerName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  scopes: string;
  hasClientSecret: boolean;
  /** URL to the IdP's account management page (optional). */
  accountManagementUrl?: string;
}

/** Explicit admin JSON backup/import format; may contain the client secret. */
export interface SsoConfigTransfer extends Omit<SsoConfigPublic, "hasClientSecret" | "accountManagementUrl"> {
  clientSecret?: string | null;
  accountManagementUrl?: string | null;
}
