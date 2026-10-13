import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for an OpenAI-compatible endpoint (Gemini free tier, Groq, Ollama…).
const requests: any[] = [];
let server: Server;
let bioReply: "valid" | "garbage" = "valid";

const REPORT = {
  overall_bio_age: 33.4,
  confidence: "medium",
  headline: "Your fitness keeps you younger than your years.",
  summary: "Based on VO2max.",
  systems: [{ key: "cardiorespiratory", bio_age: 29, confidence: "medium", status: "younger", evidence: "VO2max 48", key_metrics: [{ label: "VO2max", value: "48" }] }],
  drivers_younger: ["High VO2max"],
  drivers_older: [],
  recommendations: [{ title: "Sleep 7.5 h", detail: "Lights out 23:00", expected_effect: "Better recovery", priority: "high" }],
  data_gaps: [],
};
const EXTRACTION = { taken_at: "2026-09-30", lab_name: null, results: [{ marker_key: "glucose", name_as_printed: "Γλυκόζη", value: 92, unit: "mg/dL", ref_low: 70, ref_high: 110 }] };

const sse = (chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
const json = (res: any, status: number, body: object) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const reply = (content: string) => ({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body);
      requests.push({ url: req.url, headers: req.headers, body: b });
      if (b.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        if (b.messages.at(-1).role === "tool") {
          res.end(sse([{ choices: [{ delta: { role: "assistant", content: "You averaged " } }] }, { choices: [{ delta: { content: "8,000 steps." }, finish_reason: "stop" }] }]));
        } else {
          res.end(
            sse([
              { choices: [{ delta: { role: "assistant", content: "Checking. " } }] },
              {
                choices: [
                  {
                    delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_metric_history", arguments: '{"metric":"steps",' }, extra_content: { google: { thought_signature: "sig123" } } }] },
                  },
                ],
              },
              { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"days":7}' } }] }, finish_reason: "tool_calls" }] },
            ]),
          );
        }
        return;
      }
      const fmt = b.response_format;
      if (fmt?.type === "json_schema" && fmt.json_schema.name === "bio_age_report") return json(res, 400, { error: { message: "schema not supported" } });
      if (fmt?.type === "json_object" && JSON.stringify(b.messages).includes("App-computed anchors"))
        return json(res, 200, reply(bioReply === "valid" ? "```json\n" + JSON.stringify(REPORT) + "\n```" : "not json at all"));
      if (fmt?.json_schema?.name === "lab_extraction") return json(res, 200, reply(JSON.stringify(EXTRACTION)));
      return json(res, 200, reply("Your resting HR is steady at 56 bpm. Keep today's walk."));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.GEMINI_API_KEY = "free-key";
  process.env.AI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta/openai/`;
  process.env.AI_MODEL = "gemini-flash-latest";
});
afterAll(() => server.close());

async function member(email: string) {
  const { app } = await import("../server/index");
  const reg = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Free Tester", email, password: "password123", birthDate: "1990-01-01", sex: "male", client: "native" }),
  });
  const auth = { authorization: `Bearer ${(await reg.json()).token}`, "content-type": "application/json" };
  return { app, auth };
}

describe("free OpenAI-compatible provider", () => {
  it("is selected without an Anthropic key", async () => {
    const { app, auth } = await member("free1@t.test");
    const cfg = await (await app.request("/api/config")).json();
    expect(cfg).toMatchObject({ aiEnabled: true, aiProvider: "free" });
    expect((await (await app.request("/api/ai/status", { headers: auth })).json()).model).toBe("gemini-flash-latest");
  });

  it("chats with tools, keeps provider extras, and stores replayable history", async () => {
    const { app, auth } = await member("free2@t.test");
    const res = await app.request("/api/ai/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "How much did I walk?" }) });
    const text = await res.text();
    expect(text).toContain('"type":"tool","name":"get_metric_history"');
    expect(text).toContain("8,000 steps.");
    expect(text).toContain('"type":"done"');

    const chat = requests.filter((r) => r.body.stream);
    const second = chat.at(-1).body;
    expect(chat.at(-2).headers.authorization).toBe("Bearer free-key");
    expect(chat.at(-2).url).toBe("/v1beta/openai/chat/completions");
    expect(chat.at(-2).body.tools.map((t: any) => t.function.name)).toContain("get_bio_age");
    expect(second.messages[0].role).toBe("system");
    const call = second.messages.find((m: any) => m.tool_calls);
    expect(call.tool_calls[0]).toMatchObject({ id: "call_1", function: { name: "get_metric_history", arguments: '{"metric":"steps","days":7}' }, extra_content: { google: { thought_signature: "sig123" } } });
    const tool = second.messages.at(-1);
    expect(tool.role).toBe("tool");
    expect(JSON.parse(tool.content)).toHaveProperty("points");

    const hist = await (await app.request("/api/ai/history", { headers: auth })).json();
    expect(hist.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(hist.messages[1].text).toContain("Checking.");
    expect(hist.messages[1].text).toContain("8,000 steps.");

    // A follow-up replays the stored history in order.
    await (await app.request("/api/ai/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "Thanks" }) })).text();
    const replay = requests.filter((r) => r.body.stream).at(-2).body.messages.map((m: any) => m.role);
    expect(replay).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
  });

  it("writes the Today insight", async () => {
    const { app, auth } = await member("free3@t.test");
    expect((await (await app.request("/api/ai/insight", { headers: auth })).json()).text).toContain("56 bpm");
  });

  it("biological age: falls back from schema mode to JSON mode, and to the rules if the reply is unusable", async () => {
    const { app, auth } = await member("free4@t.test");
    await app.request("/api/metrics/manual", { method: "POST", headers: auth, body: JSON.stringify({ type: "vo2max", value: 48 }) });
    const wait = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const v = await (await app.request(`/api/bioage/${id}`, { headers: auth })).json();
        if (v.status !== "pending") return v;
        await new Promise((r) => setTimeout(r, 30));
      }
    };
    const first = await wait((await (await app.request("/api/bioage", { method: "POST", headers: auth })).json()).id);
    expect(first).toMatchObject({ status: "done", method: "ai" });
    expect(first.report.overall_bio_age).toBe(33.4);
    const anchored = requests.filter((r) => JSON.stringify(r.body.messages).includes("App-computed anchors"));
    expect(anchored.map((r) => r.body.response_format.type)).toEqual(["json_schema", "json_object"]);
    expect(JSON.stringify(anchored[0].body.messages)).toContain("fitness age from VO2max");

    bioReply = "garbage";
    const second = await wait((await (await app.request("/api/bioage", { method: "POST", headers: auth })).json()).id);
    expect(second).toMatchObject({ status: "done", method: "rules" });
    expect(second.report.systems.find((s: any) => s.key === "cardiorespiratory").bio_age).toBeGreaterThan(20);
  });

  it("structures lab text read on the device", async () => {
    const { app, auth } = await member("free5@t.test");
    const res = await app.request("/api/labs/structure", { method: "POST", headers: auth, body: JSON.stringify({ text: "Γλυκόζη 92 mg/dl 70 - 110\nΚαλιο 4,3" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      takenAt: "2026-09-30",
      labName: null,
      results: [{ markerKey: "glucose", marker: "Γλυκόζη", value: 92, unit: "mg/dL", refLow: 70, refHigh: 110 }],
    });
    expect(JSON.stringify(requests.at(-1).body.messages)).toContain("<report>");
  });
});
