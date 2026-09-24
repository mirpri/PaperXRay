import { config } from "../config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** True once an org-level model endpoint is configured; callers use this to fall back to the deterministic fake-lens instead of failing the whole upload. */
export function isModelConfigured(): boolean {
  return config.ppio.apiKey.length > 0;
}

/**
 * Minimal OpenAI-compatible chat completion call against PPIO
 * (docs/02-decisions.md #6: org-owned lenses run server-side against an
 * org-configured model endpoint). No SDK dependency — one endpoint, one
 * shape, not worth the extra package.
 */
export async function callChatModel(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${config.ppio.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ppio.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ppio.model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    throw new Error(`Model call failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model response had no message content");
  return content;
}
