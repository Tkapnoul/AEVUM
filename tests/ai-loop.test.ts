import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for the Messages API streaming endpoint: first turn calls a tool, second turn answers.
const requests: any[] = [];
let server: Server;

function sse(events: object[]) {
  return events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}
const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const msgStart = (id: string) => ({ type: "message_start", message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage } });

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push({ headers: req.headers, body: parsed });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const last = parsed.messages.at(-1);
      const isToolResult = Array.isArray(last.content) && last.content[0]?.type === "tool_result";
      if (!isToolResult) {
        res.end(
          sse([
            msgStart("msg_1"),
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check. " } },
            { type: "content_block_stop", index: 0 },
            { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "get_metric_history", input: {} } },
            { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"metric":"steps","days":7}' } },
            { type: "content_block_stop", index: 1 },
            { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } },
            { type: "message_stop" },
          ]),
        );
      } else {
        res.end(
          sse([
            msgStart("msg_2"),
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "You averaged 9,000 steps." } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 8 } },
            { type: "message_stop" },
          ]),
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

describe("AI chat loop", () => {
  it("streams text, runs the tool for the member, and stores a replayable history", async () => {
    const { app } = await import("../server/index");
    const reg = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "AI Tester", email: "ai@t.test", password: "password123", consent: true }),
    });
    const cookie = reg.headers.get("set-cookie")!.split(";")[0];

    const res = await app.request("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message: "How many steps did I do?" }),
    });
    const text = await res.text();
    const events = text.split("\n\n").filter((c) => c.startsWith("data:")).map((c) => JSON.parse(c.slice(5)));
    expect(events.map((e) => e.type)).toEqual(["text", "tool", "text", "done"]);

    expect(requests).toHaveLength(2);
    const [first, second] = requests;
    expect(first.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(first.body.fallbacks).toBe("default");
    expect(first.body.model).toBe("claude-opus-5-5");
    expect(first.body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(first.body.system[1].text).toContain("<member_snapshot>");
    // The second request replays the assistant turn unchanged, followed by the tool result.
    const toolResult = second.body.messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(JSON.parse(toolResult.content).metric).toBe("steps");
    expect(second.body.system[1].text).toBe(first.body.system[1].text); // snapshot frozen per conversation

    const hist = await (await app.request("/api/ai/history", { headers: { cookie } })).json();
    expect(hist.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(hist.messages[1].text).toContain("9,000 steps");

    // Next turn replays the full stored conversation.
    requests.length = 0;
    await (await app.request("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ message: "Thanks" }) })).text();
    expect(requests[0].body.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
  });
});
