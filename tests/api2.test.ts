import { describe, expect, it } from "vitest";
import { app } from "../server/index";

async function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* empty */
  }
  return { status: res.status, json, headers: res.headers, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

const native = (token: string) => ({ authorization: `Bearer ${token}`, origin: "https://localhost" });

describe("native app session", () => {
  it("returns a bearer token, works cross-origin without cookies, and answers CORS preflight", async () => {
    const reg = await call("POST", "/api/auth/register", { body: { name: "Native One", email: "n1@t.test", password: "password123", client: "native" } });
    expect(reg.status).toBe(200);
    expect(reg.json.token).toBeTruthy();
    expect(reg.cookie).toBe("");
    // The first account is the admin.
    const me = await call("GET", "/api/auth/me", { headers: native(reg.json.token) });
    expect(me.json).toMatchObject({ email: "n1@t.test", is_admin: 1 });
    // Bearer writes from the app's origin are not blocked by the CSRF origin check.
    const ok = await call("PATCH", "/api/auth/me", { headers: { ...native(reg.json.token), host: "aevum.example" }, body: { birthDate: "1990-05-01" } });
    expect(ok.status).toBe(200);
    const pre = await app.request("/api/auth/me", { method: "OPTIONS", headers: { origin: "capacitor://localhost", "access-control-request-method": "GET", "access-control-request-headers": "authorization" } });
    expect(pre.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    const evil = await app.request("/api/auth/me", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("ingests a batch from Apple Health / Health Connect and drops out-of-range values", async () => {
    const { json } = await call("POST", "/api/auth/login", { body: { email: "n1@t.test", password: "password123", client: "native" } });
    const day = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const r = await call("POST", "/api/metrics/ingest", {
      headers: native(json.token),
      body: {
        source: "apple_health",
        metrics: [
          { type: "steps", ts: day, value: 10432 },
          { type: "hrv", ts: Date.now() - 3600_000, value: 52 },
          { type: "vo2max", ts: Date.now() - 7200_000, value: 44.5 },
          { type: "spo2", ts: Date.now(), value: 0.97 }, // unit error → dropped
        ],
        sleep: [{ date: new Date().toISOString().slice(0, 10), totalMin: 431, deepMin: 70, remMin: 95, lightMin: 266 }],
      },
    });
    expect(r.json).toMatchObject({ ok: true, stored: 3, nights: 1, dropped: 1 });
    const devices = await call("GET", "/api/devices", { headers: native(json.token) });
    expect(devices.json.devices.map((d: any) => d.kind)).toContain("apple_health");
    const summary = await call("GET", "/api/metrics/summary", { headers: native(json.token) });
    expect(summary.json.latest.hrv.value).toBe(52);
    expect(summary.json.sleep.total_min).toBe(431);
  });
});

describe("push sources with tokens", () => {
  it("accepts Health Auto Export and generic API payloads only with the right token kind", async () => {
    const reg = await call("POST", "/api/auth/register", { body: { name: "Hae User", email: "hae@t.test", password: "password123", client: "native" } });
    const h = native(reg.json.token);
    const hae = (await call("POST", "/api/devices/token", { headers: h, body: { kind: "health_auto_export" } })).json.token;
    const apiTok = (await call("POST", "/api/devices/token", { headers: h, body: { kind: "api" } })).json.token;
    const payload = { data: { metrics: [{ name: "resting_heart_rate", units: "count/min", data: [{ date: "2026-10-12 06:00:00 +0300", qty: 56 }] }] } };
    expect((await call("POST", "/api/device/ingest/hae", { headers: { authorization: `Bearer ${hae}` }, body: payload })).json).toMatchObject({ ok: true, stored: 1 });
    expect((await call("POST", "/api/device/ingest/hae", { headers: { authorization: `Bearer ${apiTok}` }, body: payload })).status).toBe(401);
    const gen = await call("POST", "/api/device/ingest/generic", {
      headers: { authorization: `Bearer ${apiTok}` },
      body: { metrics: [{ type: "bp_systolic", ts: Date.now(), value: 118 }] },
    });
    expect(gen.json).toMatchObject({ ok: true, stored: 1 });
    // A session JWT is not a device token.
    expect((await call("POST", "/api/device/ingest/generic", { headers: { authorization: `Bearer ${reg.json.token}` }, body: { metrics: [] } })).status).toBe(401);
  });
});

describe("admin and labs", () => {
  it("lets the admin turn a friend into a coach who joins everyone's care team", async () => {
    const admin = (await call("POST", "/api/auth/login", { body: { email: "n1@t.test", password: "password123", client: "native" } })).json.token;
    const friend = await call("POST", "/api/auth/register", { body: { name: "Coach Friend", email: "coachf@t.test", password: "password123", client: "native" } });
    const member = await call("POST", "/api/auth/register", { body: { name: "Plain Member", email: "pm@t.test", password: "password123", client: "native" } });
    const friendId = (await call("GET", "/api/auth/me", { headers: native(friend.json.token) })).json.id;
    expect((await call("PATCH", `/api/admin/users/${friendId}`, { headers: native(member.json.token), body: { role: "coach" } })).status).toBe(403);
    expect((await call("PATCH", `/api/admin/users/${friendId}`, { headers: native(admin), body: { role: "coach" } })).status).toBe(200);
    const experts = (await call("GET", "/api/care/experts", { headers: native(member.json.token) })).json.experts;
    expect(experts.find((e: any) => e.id === friendId)).toMatchObject({ role: "coach", on_team: 1 });
    const slots = (await call("GET", `/api/care/experts/${friendId}/slots?days=10`, { headers: native(member.json.token) })).json.slots;
    expect(slots.length).toBeGreaterThan(0);
  });

  it("saves a batch of labs with catalogue keys and computes PhenoAge from them", async () => {
    const tok = (await call("POST", "/api/auth/login", { body: { email: "n1@t.test", password: "password123", client: "native" } })).json.token;
    const results = [
      { markerKey: "albumin", marker: "Λευκωματίνη", value: 45, unit: "g/L" },
      { markerKey: "creatinine", marker: "Κρεατινίνη", value: 0.9, unit: "mg/dL" },
      { markerKey: null, marker: "Γλυκόζη", value: 5, unit: "mmol/L" },
      { markerKey: "crp", marker: "hs-CRP", value: 1, unit: "mg/L" },
      { markerKey: "lymphocyte_pct", marker: "Λεμφοκύτταρα %", value: 30, unit: "%" },
      { markerKey: "mcv", marker: "MCV", value: 90, unit: "fL" },
      { markerKey: "rdw", marker: "RDW", value: 13, unit: "%" },
      { markerKey: "alp", marker: "ALP", value: 70, unit: "U/L" },
      { markerKey: "wbc", marker: "WBC", value: 6, unit: "10^9/L" },
    ];
    expect((await call("POST", "/api/labs/batch", { headers: native(tok), body: { takenAt: new Date().toISOString().slice(0, 10), results } })).json.saved).toBe(9);
    const bio = (await call("GET", "/api/bioage", { headers: native(tok) })).json;
    expect(bio.birthDateMissing).toBe(false);
    expect(bio.phenoAge.missing).toEqual([]);
    expect(bio.phenoAge.value).toBeLessThan(bio.chronoAge);
    expect(bio.aiEnabled).toBe(false);
    expect((await call("POST", "/api/bioage", { headers: native(tok) })).status).toBe(503);
  });
});
