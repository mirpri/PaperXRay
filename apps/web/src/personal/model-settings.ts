/**
 * The personal model endpoint (docs/02-decisions.md #6). Lives only in this
 * browser's localStorage: it is never sent to the Paper X-Ray server, only
 * to the endpoint itself. Anyone with access to this browser profile can
 * read it, which the settings UI says plainly.
 */
export interface PersonalModelSettings {
  /** OpenAI-compatible base URL, e.g. http://localhost:11434/v1 (Ollama) or https://api.openai.com/v1. */
  baseUrl: string;
  model: string;
  /** Empty for keyless local endpoints. */
  apiKey: string;
}

const STORAGE_KEY = "pxr.personalModel";

export const DEFAULT_PERSONAL_MODEL: PersonalModelSettings = {
  baseUrl: "http://localhost:11434/v1",
  model: "llama3.1",
  apiKey: "",
};

export function loadPersonalModelSettings(): PersonalModelSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersonalModelSettings>;
    if (typeof parsed.baseUrl !== "string" || typeof parsed.model !== "string") return null;
    return { baseUrl: parsed.baseUrl, model: parsed.model, apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "" };
  } catch {
    return null;
  }
}

export function savePersonalModelSettings(settings: PersonalModelSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearPersonalModelSettings(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
