import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { config } from "../config.js";
import { requireRole, requireUser, type AppEnv } from "../auth.js";
import { body, HttpError, rateLimit } from "../lib/validate.js";
import { newId } from "../lib/ids.js";
import { isoDate } from "../lib/time.js";
import { SYSTEM_PROMPT } from "../ai/prompt.js";
import { TOOLS, runTool } from "../ai/tools.js";
import { memberSnapshot } from "../ai/context.js";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

const client = config.ai.enabled ? new Anthropic() : null;

// A conversation is replayed append-only (thinking blocks must come back unchanged),
// so instead of trimming old turns we start a fresh conversation after a pause or once it gets long.
const CONVERSATION_IDLE_MS = 6 * 3600_000;
const CONVERSATION_MAX_ROWS = 80;
const MAX_TOOL_ROUNDS = 6;

// Server-side fallback: if a safety classifier declines, the API retries on the recommended fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export const aiRoutes = new Hono<AppEnv>();
aiRoutes.use("*", requireUser);

aiRoutes.get("/status", (c) => c.json({ enabled: config.ai.enabled, model: config.ai.model }));

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
    const text = textOf(JSON.parse(r.content));
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
  if (!client) throw new HttpError(503, "ai_not_configured");
  const userId = c.get("user").id;
  rateLimit(`ai:${userId}`, 40, 3600_000);
  const { message } = await body(c, z.object({ message: z.string().trim().min(1).max(4000) }));

  let conv = currentConversation(userId);
  if (!conv || conv.rows.length > CONVERSATION_MAX_ROWS || Date.now() - conv.lastActivity > CONVERSATION_IDLE_MS) {
    conv = startConversation(userId);
  }
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

/** One short, data-grounded insight per member per day for the Today screen. */
aiRoutes.get("/insight", requireRole("member"), async (c) => {
  const user = c.get("user");
  const date = isoDate(Date.now());
  const cached = get<{ content: string }>("SELECT content FROM ai_insights WHERE user_id = ? AND date = ?", user.id, date);
  if (cached) return c.json({ date, text: cached.content });
  if (!client) return c.json({ date, text: null, reason: "ai_not_configured" });
  rateLimit(`insight:${user.id}`, 5, 3600_000);

  const lang = user.locale === "el" ? "Greek" : "English";
  try {
    const msg = await client.beta.messages.create({
      model: config.ai.model,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: `<member_snapshot>\n${memberSnapshot(user.id)}\n</member_snapshot>\n\nWrite today's insight for the Today screen in ${lang}: 2 short sentences. First, the single most notable thing in the data (with the number). Second, one concrete action for today. If there is not enough data, say what to do to get it. No greeting, no headings.`,
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
