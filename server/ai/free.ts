import { config } from "../config.js";

// Minimal client for OpenAI-compatible chat endpoints (Google Gemini free tier, Groq, OpenRouter, Ollama…).
// Plain fetch, no SDK: the call shapes we need are small and identical across these providers.

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  // Providers may attach extra fields (Gemini: thought signatures) that must be sent back unchanged.
  [extra: string]: unknown;
}

export type AssistantMessage = { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export interface FunctionTool {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

export class FreeAiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post(body: object): Promise<Response> {
  const cfg = config.freeAi;
  if (!cfg) throw new Error("free_ai_not_configured");
  // Inside the phone app (local mode) the runtime may supply a fetch that can fall back to native HTTP.
  const doFetch = (Reflect.get(globalThis, "__aevumFetch") as typeof fetch | undefined) ?? fetch;
  const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ model: cfg.model, ...body }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new FreeAiError(res.status, (await res.text().catch(() => "")).slice(0, 500));
  return res;
}

/** One non-streaming completion; returns the text. */
export async function complete(messages: ChatMessage[], opts: { json?: { name: string; schema: object } | "object"; maxTokens?: number } = {}): Promise<string> {
  const response_format =
    opts.json === "object" ? { type: "json_object" } : opts.json ? { type: "json_schema", json_schema: { name: opts.json.name, schema: opts.json.schema } } : undefined;
  const res = await post({ messages, max_tokens: opts.maxTokens ?? 8000, ...(response_format ? { response_format } : {}) });
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Asks for JSON matching `schema`: first with the provider's structured-output mode, then (if the provider
 * rejects the schema) in plain JSON mode with the schema in the prompt. `validate` decides what counts.
 */
export async function completeJson<T>(messages: ChatMessage[], name: string, schema: object, validate: (x: unknown) => T | null, maxTokens = 8000): Promise<T | null> {
  const attempts: (() => Promise<string>)[] = [
    () => complete(messages, { json: { name, schema }, maxTokens }),
    () =>
      complete(
        [...messages, { role: "user", content: `Reply with only a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}` }],
        { json: "object", maxTokens },
      ),
  ];
  for (const attempt of attempts) {
    try {
      const out = validate(parseJsonReply(await attempt()));
      if (out) return out;
    } catch (err) {
      // 400 = this provider doesn't accept the schema form; try the next. Anything else is a real failure.
      if (err instanceof FreeAiError && err.status !== 400) throw err;
    }
  }
  return null;
}

/**
 * Streams one assistant turn. Text deltas go to `onText`; tool calls are accumulated from their deltas.
 * Returns the complete assistant message, ready to append to the history.
 */
export async function streamTurn(messages: ChatMessage[], tools: FunctionTool[], onText: (delta: string) => void): Promise<{ message: AssistantMessage; finish: string | null }> {
  const res = await post({ messages, ...(tools.length ? { tools } : {}), stream: true, max_tokens: 8000 });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let finish: string | null = null;
  const calls: ToolCall[] = [];
  const extra: Record<string, unknown> = {};

  type Delta = { content?: string | null; role?: string; tool_calls?: (Partial<ToolCall> & { index?: number; function?: { name?: string; arguments?: string } })[]; [k: string]: unknown };
  const handle = (data: string) => {
    if (data === "[DONE]") return;
    const chunk = JSON.parse(data) as { choices?: { delta?: Delta; finish_reason?: string | null }[] };
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const { content, role: _role, tool_calls, ...other } = choice.delta ?? {};
    if (content) {
      text += content;
      onText(content);
    }
    for (const [i, tc] of (tool_calls ?? []).entries()) {
      const { index, function: fn, ...rest } = tc;
      const cur = (calls[index ?? i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      Object.assign(cur, rest);
      if (fn?.name) cur.function.name = fn.name;
      if (fn?.arguments) cur.function.arguments += fn.arguments;
    }
    for (const [k, v] of Object.entries(other)) if (v != null) extra[k] = v;
    if (choice.finish_reason) finish = choice.finish_reason;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) handle(line.slice(5).trim());
    }
  }
  if (buf.trim().startsWith("data:")) handle(buf.trim().slice(5).trim());

  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
  return {
    message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...extra },
    finish,
  };
}

/** Parses JSON from a model reply, tolerating a ```json fence around it. */
export function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(t);
}
