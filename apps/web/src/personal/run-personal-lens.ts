import type { LensOutputItem, LensSpec } from "@paper-xray/contracts";
import { buildLensSystemPrompt, buildLensUserMessage, parseLensModelOutput } from "@paper-xray/contracts";
import type { PersonalModelSettings } from "./model-settings";

/**
 * Runs a personal lens entirely in the browser (docs/02-decisions.md #6):
 * the request goes straight from here to the user's own OpenAI-compatible
 * endpoint with the user's own key. Only the resulting quoted items are
 * sent to the Paper X-Ray server, which re-locates and re-verifies them.
 *
 * The endpoint must allow this page's origin (CORS). For Ollama that means
 * starting it with OLLAMA_ORIGINS set to the app's origin.
 */
export async function runPersonalLens(params: {
  spec: LensSpec;
  normalizedText: string;
  settings: PersonalModelSettings;
  fetchImpl?: typeof fetch;
}): Promise<LensOutputItem[]> {
  const { spec, normalizedText, settings, fetchImpl = fetch } = params;
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: buildLensSystemPrompt(spec) },
          { role: "user", content: buildLensUserMessage(normalizedText) },
        ],
      }),
    });
  } catch {
    throw new Error(
      `Could not reach ${settings.baseUrl}. Check that it is running and allows this page's origin (CORS).`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Model endpoint answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model response had no message content");
  return parseLensModelOutput(content, spec.maxAnnotations);
}
