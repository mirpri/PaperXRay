export interface ChatModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Minimal OpenAI-compatible chat completion call against the selected endpoint
 * (docs/02-decisions.md #6: org-owned lenses run server-side against an
 * org-configured model endpoint). No SDK dependency — one endpoint, one
 * shape, not worth the extra package.
 */
export async function callChatModel(messages: ChatMessage[], endpoint: ChatModelConfig, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${endpoint.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    // Provider error bodies may contain request details or credentials.
    throw new Error(`Model call failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model response had no message content");
  return content;
}
