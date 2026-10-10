import type { SsoConfigTransfer } from "@paper-xray/contracts";

export const MAX_SSO_JSON_BYTES = 64 * 1024;

/** Validate completely before replacing the form; unknown backup fields are ignored. */
export function parseSsoConfigJson(text: string): SsoConfigTransfer {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("Invalid JSON file."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SSO JSON must be an object.");
  const fields = value as Record<string, unknown>;
  function required(key: string): string {
    if (typeof fields[key] !== "string") throw new Error(`SSO JSON: ${key} must be a string.`);
    return fields[key] as string;
  }
  const result: SsoConfigTransfer = {
    providerName: required("providerName"), authorizationEndpoint: required("authorizationEndpoint"),
    tokenEndpoint: required("tokenEndpoint"), userinfoEndpoint: required("userinfoEndpoint"),
    clientId: required("clientId"), scopes: required("scopes"),
  };
  for (const key of ["clientSecret", "accountManagementUrl"] as const) {
    if (fields[key] === undefined) continue;
    if (fields[key] !== null && typeof fields[key] !== "string") throw new Error(`SSO JSON: ${key} must be a string or null.`);
    result[key] = fields[key] as string | null;
  }
  if (result.accountManagementUrl?.trim()) {
    try {
      const url = new URL(result.accountManagementUrl.trim());
      if (result.accountManagementUrl.trim().length > 512 || !["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch { throw new Error("SSO JSON: accountManagementUrl must be an absolute HTTP or HTTPS URL (up to 512 characters)."); }
  }
  return result;
}
