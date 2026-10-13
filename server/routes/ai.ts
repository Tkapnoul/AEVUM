import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { aiProvider, config } from "../config.js";
import { requireRole, requireUser, type AppEnv } from "../auth.js";
import { body, HttpError, rateLimit } from "../lib/validate.js";
import { newId } from "../lib/ids.js";
import { isoDate } from "../lib/time.js";
import { SYSTEM_PROMPT } from "../ai/prompt.js";
import { TOOLS, runTool } from "../ai/tools.js";
import { memberSnapshot } from "../ai/context.js";
import { anthropic, FALLBACK } from "../ai/client.js";
import { dailyInsight, insights } from "../lib/insights.js";
import { complete, FreeAiError, streamTurn, type ChatMessage, type FunctionTool } from "../ai/free.js";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

const client = anthropic;

// A conversation is replayed append-only (thinking blocks must come back unchanged),
// so instead of trimming old turns we start a fresh conversation after a pause or once it gets long.
const CONVERSATION_IDLE_MS = 6 * 3600_000;
const CONVERSATION_MAX_ROWS = 80;
const MAX_TOOL_ROUNDS = 6;


export const aiRoutes = new Hono<AppEnv>();
aiRoutes.use("*", requireUser);

aiRoutes.get("/status", (c) =>
  c.json({ enabled: aiProvider != null, provider: aiProvider, model: aiProvider === "free" ? config.freeAi!.model : config.ai.model }),
);

// The free provider speaks the OpenAI tool format; same tools, same handlers.
const FREE_TOOLS: FunctionTool[] = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } }));

/** Anthropic rows hold an array of content blocks; free-provider rows hold one OpenAI-style message object. */
const isFreeRow = (r: Row) => !r.content.startsWith("[");

interface Row {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  created_at: number;
}

interface Conversation {
  id: string;
  snapshot: string;
  rows: Row[];
  lastActivity: number;
}

function currentConversation(userId: string): Conversation | null {
  const lastRow = get<Row>("SELECT * FROM ai_messages WHERE user_id = ? ORDER BY id DESC LIMIT 1", userId);
  if (!lastRow) return null;
  const rows = all<Row>("SELECT * FROM ai_messages WHERE user_id = ? AND conversation_id = ? ORDER BY id", userId, lastRow.conversation_id);
  const snap = rows.find((r) => r.role === "snapshot");
  if (!snap) return null;
  return { id: lastRow.conversation_id, snapshot: snap.content, rows: rows.filter((r) => r.role !== "snapshot"), lastActivity: lastRow.created_at };
}

function startConversation(userId: string): Conversation {
  const id = newId("conv");
  const snapshot = memberSnapshot(userId);
  const now = Date.now();
  run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'snapshot', ?, ?)", userId, id, snapshot, now);
  return { id, snapshot, rows: [], lastActivity: now };
}

const textOf = (content: ContentBlock[] | Anthropic.Beta.BetaContentBlockParam[]) =>
  content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

aiRoutes.get("/history", (c) => {
  const conv = currentConversation(c.get("user").id);
  if (!conv) return c.json({ messages: [] });
  const out: { role: "user" | "assistant"; text: string; ts: number }[] = [];
  for (const r of conv.rows) {
    if (r.role === "tool") continue;
    const parsed = JSON.parse(r.content);
    const text = Array.isArray(parsed) ? textOf(parsed) : typeof parsed.content === "string" ? parsed.content : "";
    if (!text) continue; // tool results and tool-only turns
    const prev = out[out.length - 1];
    if (prev && prev.role === r.role) prev.text += `\n\n${text}`;
    else out.push({ role: r.role as "user" | "assistant", text, ts: r.created_at });
  }
  return c.json({ messages: out });
});

aiRoutes.post("/new", (c) => {
  startConversation(c.get("user").id);
  return c.json({ ok: true });
});

aiRoutes.post("/chat", requireRole("member"), async (c) => {
  if (!aiProvider) throw new HttpError(503, "ai_not_configured");
  const userId = c.get("user").id;
  rateLimit(`ai:${userId}`, 40, 3600_000);
  const { message } = await body(c, z.object({ message: z.string().trim().min(1).max(4000) }));

  let conv = currentConversation(userId);
  const wrongFormat = conv?.rows.some((r) => isFreeRow(r) !== (aiProvider === "free")); // provider changed since
  if (!conv || wrongFormat || conv.rows.length > CONVERSATION_MAX_ROWS || Date.now() - conv.lastActivity > CONVERSATION_IDLE_MS) {
    conv = startConversation(userId);
  }
  if (aiProvider === "free") return freeChat(c, userId, message, conv);
  if (!client) throw new HttpError(503, "ai_not_configured");
  const convId = conv.id;
  const messages: MessageParam[] = conv.rows.map((r) => ({ role: r.role as "user" | "assistant", content: JSON.parse(r.content) }));
  const userTurn: MessageParam = { role: "user", content: [{ type: "text", text: message }] };
  messages.push(userTurn);
  run(
    "INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
    userId, convId, JSON.stringify(userTurn.content), Date.now(),
  );

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: `<member_snapshot>\n${conv.snapshot}\n</member_snapshot>` },
  ];

  return streamSSE(c, async (sse) => {
    const send = (data: object) => sse.writeSSE({ data: JSON.stringify(data) });
    try {
      let jsonRetries = 0;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = client.beta.messages.stream({
          model: config.ai.model,
          max_tokens: 16000,
          system,
          messages,
          tools: TOOLS,
          output_config: { effort: config.ai.effort },
          cache_control: { type: "ephemeral" },
          ...FALLBACK,
        });
        stream.on("text", (delta) => void send({ type: "text", delta }));

        let msg: Anthropic.Beta.BetaMessage;
        try {
          msg = await stream.finalMessage();
          jsonRetries = 0;
        } catch (err) {
          // Only an unparseable streamed tool input is retried; API errors propagate.
          if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
          round--;
          continue;
        }

        if (msg.stop_reason === "refusal") {
          await send({ type: "refusal" });
          break;
        }
        const assistantTurn: MessageParam = { role: "assistant", content: msg.content };

        if (msg.stop_reason === "pause_turn") {
          messages.push(assistantTurn);
          run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)", userId, convId, JSON.stringify(msg.content), Date.now());
          continue;
        }

        const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (!toolUses.length || msg.stop_reason === "max_tokens") {
          run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)", userId, convId, JSON.stringify(msg.content), Date.now());
          break;
        }

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((t) => {
          void send({ type: "tool", name: t.name });
          try {
            return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(runTool(userId, t.name, t.input)) };
          } catch (err) {
            return { type: "tool_result", tool_use_id: t.id, is_error: true, content: err instanceof Error ? err.message : "tool failed" };
          }
        });
        const resultTurn: MessageParam = { role: "user", content: results };
        messages.push(assistantTurn, resultTurn);
        // Persist the tool call and its results together so stored history is always replayable.
        tx(() => {
          run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)", userId, convId, JSON.stringify(msg.content), Date.now());
          run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)", userId, convId, JSON.stringify(results), Date.now());
        });
      }
      await send({ type: "done" });
    } catch (err) {
      console.error("[ai] chat failed", err);
      const code = err instanceof Anthropic.RateLimitError ? "rate_limited" : err instanceof Anthropic.APIError ? "upstream_error" : "internal_error";
      await send({ type: "error", code });
    }
  });
});

/** Rule-based observations for the analysis screen (works without an API key). */
aiRoutes.get("/analysis", requireRole("member"), (c) => c.json({ items: insights(c.get("user").id) }));

/** One short, data-grounded insight per member per day for the Today screen. */
aiRoutes.get("/insight", requireRole("member"), async (c) => {
  const user = c.get("user");
  const date = isoDate(Date.now());
  const cached = get<{ content: string }>("SELECT content FROM ai_insights WHERE user_id = ? AND date = ?", user.id, date);
  if (cached) return c.json({ date, text: cached.content });
  // Without any AI the rule-based observation is computed live (it is cheap and tracks new syncs).
  if (!aiProvider) return c.json({ date, text: dailyInsight(user.id) });
  rateLimit(`insight:${user.id}`, 5, 3600_000);

  const lang = user.locale === "el" ? "Greek" : "English";
  const ask = `<member_snapshot>\n${memberSnapshot(user.id)}\n</member_snapshot>\n\nWrite today's insight for the Today screen in ${lang}: 2 short sentences. First, the single most notable thing in the data (with the number). Second, one concrete action for today. If there is not enough data, say what to do to get it. No greeting, no headings.`;
  if (aiProvider === "free") {
    try {
      const text = (await complete([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: ask }], { maxTokens: 2000 })).trim();
      if (text) run("INSERT OR REPLACE INTO ai_insights (user_id, date, content, created_at) VALUES (?, ?, ?, ?)", user.id, date, text, Date.now());
      return c.json({ date, text: text || dailyInsight(user.id) });
    } catch (err) {
      console.error("[ai] insight failed", err);
      return c.json({ date, text: dailyInsight(user.id) }); // free tiers hit rate limits; fall back to the rules
    }
  }
  if (!client) return c.json({ date, text: dailyInsight(user.id) });
  try {
    const msg = await client.beta.messages.create({
      model: config.ai.model,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: ask,
        },
      ],
      ...FALLBACK,
    });
    if (msg.stop_reason === "refusal") return c.json({ date, text: null, reason: "refusal" });
    const text = textOf(msg.content).trim();
    if (text) run("INSERT OR REPLACE INTO ai_insights (user_id, date, content, created_at) VALUES (?, ?, ?, ?)", user.id, date, text, Date.now());
    return c.json({ date, text: text || null });
  } catch (err) {
    console.error("[ai] insight failed", err);
    return c.json({ date, text: null, reason: "upstream_error" });
  }
});

/** Chat through the free OpenAI-compatible provider: same tools, same storage, OpenAI message format. */
function freeChat(c: Parameters<typeof streamSSE>[0], userId: string, message: string, conv: Conversation) {
  const convId = conv.id;
  const history = conv.rows.map((r) => JSON.parse(r.content) as ChatMessage);
  const userTurn: ChatMessage = { role: "user", content: message };
  run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)", userId, convId, JSON.stringify(userTurn), Date.now());
  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n<member_snapshot>\n${conv.snapshot}\n</member_snapshot>` },
    ...history,
    userTurn,
  ];

  return streamSSE(c, async (sse) => {
    const send = (data: object) => sse.writeSSE({ data: JSON.stringify(data) });
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // Last round without tools, so the conversation always ends on an answer.
        const { message: msg } = await streamTurn(messages, round < MAX_TOOL_ROUNDS - 1 ? FREE_TOOLS : [], (delta) => void send({ type: "text", delta }));
        messages.push(msg);
        if (!msg.tool_calls?.length) {
          run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)", userId, convId, JSON.stringify(msg), Date.now());
          break;
        }
        const results: ChatMessage[] = msg.tool_calls.map((t) => {
          void send({ type: "tool", name: t.function.name });
          let content: string;
          try {
            content = JSON.stringify(runTool(userId, t.function.name, JSON.parse(t.function.arguments || "{}")));
          } catch (err) {
            content = JSON.stringify({ error: err instanceof Error ? err.message : "tool failed" });
          }
          return { role: "tool", tool_call_id: t.id, content };
        });
        messages.push(...results);
        tx(() => {
          run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)", userId, convId, JSON.stringify(msg), Date.now());
          for (const r of results) run("INSERT INTO ai_messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, 'tool', ?, ?)", userId, convId, JSON.stringify(r), Date.now());
        });
      }
      await send({ type: "done" });
    } catch (err) {
      console.error("[ai] free chat failed", err);
      await send({ type: "error", code: err instanceof FreeAiError ? (err.status === 429 ? "rate_limited" : "upstream_error") : "internal_error" });
    }
  });
}
