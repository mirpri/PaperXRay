import type { ProviderDraft } from "@paper-xray/contracts";
export function validateProvider(body: unknown): { ok: true; draft: ProviderDraft } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!body || typeof body !== "object") return fail("Provider settings are required");
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 120) return fail("Provider name is required (max 120 characters)");
  if (typeof b.baseUrl !== "string" || b.baseUrl.length > 512) return fail("Invalid base URL");
  let url: URL;
  try { url = new URL(b.baseUrl.trim()); } catch { return fail("Invalid base URL"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return fail("Base URL must be HTTP(S), without credentials, query or fragment");
  if (!Array.isArray(b.models) || b.models.length > 100 || b.models.some((m) => typeof m !== "string" || !m.trim() || m.length > 255)) return fail("Provide at most 100 model suggestions (max 255 characters each)");
  if (b.apiKey !== undefined && b.apiKey !== null && (typeof b.apiKey !== "string" || b.apiKey.length > 8192 || /[\r\n]/.test(b.apiKey))) return fail("Invalid API key");
  return { ok: true, draft: { name: b.name.trim(), baseUrl: url.href.replace(/\/+$/, ""), models: [...new Set((b.models as string[]).map((m) => m.trim()))], apiKey: b.apiKey === undefined ? undefined : b.apiKey === null ? null : (b.apiKey as string).trim() || null } };
}
