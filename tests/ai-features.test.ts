import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const requests: any[] = [];
let server: Server;

const REPORT = {
  overall_bio_age: 33.4,
  confidence: "medium",
  headline: "Your fitness keeps you younger than your years.",
  summary: "Based on VO2max and resting heart rate.",
  systems: [
    { key: "cardiorespiratory", bio_age: 29, confidence: "medium", status: "younger", evidence: "VO2max 48", key_metrics: [{ label: "VO2max", value: "48" }] },
    { key: "metabolic", bio_age: null, confidence: "low", status: "unknown", evidence: "", key_metrics: [] },
  ],
  drivers_younger: ["High VO2max"],
  drivers_older: ["Short sleep"],
  recommendations: [{ title: "Sleep 7.5 h", detail: "Lights out 23:00", expected_effect: "Better recovery", priority: "high" }],
  data_gaps: [{ what: "Blood tests", why: "Unlocks PhenoAge" }],
};

const EXTRACTION = {
  taken_at: "2026-09-30",
  lab_name: "Test Lab",
  results: [
    { marker_key: "glucose", name_as_printed: "ΓΛΥΚΟΖΗ", value: 92, unit: "mg/dL", ref_low: 70, ref_high: 110 },
    { marker_key: "other", name_as_printed: "ΚΑΛΙΟ", value: 4.3, unit: "mmol/L", ref_low: 3.5, ref_high: 5.1 },
  ],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push({ headers: req.headers, body: parsed });
      const content = parsed.messages[0].content;
      const isExtraction = Array.isArray(content) && content.some((b: any) => b.type === "image" || b.type === "document");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_x",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(isExtraction ? EXTRACTION : REPORT) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("AI biological age", () => {
  it("runs a report in the background with structured output and shows it", async () => {
    const { app } = await import("../server/index");
    const reg = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bio Tester", email: "bio@t.test", password: "password123", birthDate: "1990-01-01", client: "native" }),
    });
    const auth = { authorization: `Bearer ${(await reg.json()).token}`, "content-type": "application/json" };
    await app.request("/api/metrics/manual", { method: "POST", headers: auth, body: JSON.stringify({ type: "vo2max", value: 48 }) });

    const start = await app.request("/api/bioage", { method: "POST", headers: auth });
    expect(start.status).toBe(200);
    const { id } = await start.json();
    let view: any;
    for (let i = 0; i < 50; i++) {
      view = await (await app.request(`/api/bioage/${id}`, { headers: auth })).json();
      if (view.status !== "pending") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(view.status).toBe("done");
    expect(view.report.overall_bio_age).toBe(33.4);

    const req = requests.at(-1);
    expect(req.body.output_config.effort).toBe("high");
    expect(req.body.output_config.format.type).toBe("json_schema");
    expect(req.body.fallbacks).toBe("default");
    const sent = JSON.parse(req.body.messages[0].content.replace(/^[^{]*/, ""));
    expect(sent.member.chronological_age).toBeGreaterThan(35);
    expect(sent.wearable_and_body_metrics_90d.vo2max.latest).toBe(48);
    expect(sent.phenoage.value).toBeNull();

    const overview = await (await app.request("/api/bioage", { headers: auth })).json();
    expect(overview.latestDone.report.headline).toContain("fitness");
    expect(overview.history).toHaveLength(1);

    // The chat assistant can read the report through its tool.
    const { runTool } = await import("../server/ai/tools");
    const me = await (await app.request("/api/auth/me", { headers: auth })).json();
    expect((runTool(me.id, "get_bio_age", {}) as any).latest.report.overall_bio_age).toBe(33.4);
  });
});

describe("AI lab extraction", () => {
  it("reads a PDF into reviewable results and maps unknown tests to free text", async () => {
    const { app } = await import("../server/index");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bio@t.test", password: "password123", client: "native" }),
    });
    const token = (await login.json()).token;
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([37, 80, 68, 70])], "labs.pdf", { type: "application/pdf" }));
    const res = await app.request("/api/labs/extract", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.takenAt).toBe("2026-09-30");
    expect(out.results).toEqual([
      { markerKey: "glucose", marker: "ΓΛΥΚΟΖΗ", value: 92, unit: "mg/dL", refLow: 70, refHigh: 110 },
      { markerKey: null, marker: "ΚΑΛΙΟ", value: 4.3, unit: "mmol/L", refLow: 3.5, refHigh: 5.1 },
    ]);
    const doc = requests.at(-1).body.messages[0].content[0];
    expect(doc).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });

    const bad = new FormData();
    bad.append("file", new File(["hello"], "x.txt", { type: "text/plain" }));
    expect((await app.request("/api/labs/extract", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: bad })).status).toBe(400);
  });
});
