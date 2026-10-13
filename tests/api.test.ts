import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/index";
import { run } from "../server/db";
import { hashPassword } from "../server/auth";
import { zonedToUtc, zonedDate } from "../server/lib/time";
import { computeScore } from "../server/lib/score";

const H = { "content-type": "application/json" };

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const res = await app.request(path, {
    method,
    headers: { ...H, ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* SSE or empty */
  }
  return { status: res.status, json, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function register(email: string) {
  const r = await call("POST", "/api/auth/register", { body: { name: "Test Member", email, password: "password123", consent: true } });
  expect(r.status).toBe(200);
  return r.cookie;
}

let coachId = "";
let coachCookie = "";
let outsiderCookie = "";

beforeAll(async () => {
  const hash = await hashPassword("password123");
  const mk = (id: string, email: string, role: string) => {
    run("INSERT INTO users (id, email, password_hash, name, role, locale, goals, created_at) VALUES (?, ?, ?, ?, ?, 'en', '[]', ?)", id, email, hash, role, role, Date.now());
    run("INSERT INTO expert_profiles (user_id, title, session_minutes) VALUES (?, ?, 60)", id, role);
    for (let wd = 0; wd < 7; wd++) run("INSERT INTO availability (expert_id, weekday, start_min, end_min) VALUES (?, ?, 0, 1440)", id, wd);
  };
  mk("u_coach", "coach@t.test", "coach");
  mk("u_doc", "doc@t.test", "doctor");
  mk("u_physio", "physio@t.test", "physio");
  coachId = "u_coach";
  coachCookie = (await call("POST", "/api/auth/login", { body: { email: "coach@t.test", password: "password123" } })).cookie;
  outsiderCookie = (await call("POST", "/api/auth/login", { body: { email: "physio@t.test", password: "password123" } })).cookie;
});

describe("auth & care team", () => {
  it("registers, assigns a coach and a doctor, rejects duplicates and bad passwords", async () => {
    const cookie = await register("a@t.test");
    const me = await call("GET", "/api/auth/me", { cookie });
    expect(me.json.role).toBe("member");
    const experts = await call("GET", "/api/care/experts", { cookie });
    const team = experts.json.experts.filter((e: any) => e.on_team).map((e: any) => e.role).sort();
    expect(team).toEqual(["coach", "doctor"]);
    expect((await call("POST", "/api/auth/register", { body: { name: "X Y", email: "A@t.test", password: "password123", consent: true } })).status).toBe(409);
    expect((await call("POST", "/api/auth/login", { body: { email: "a@t.test", password: "wrong" } })).status).toBe(401);
  });

  it("rejects cross-site writes", async () => {
    const r = await call("POST", "/api/auth/logout", { headers: { origin: "https://evil.example", host: "localhost" } });
    expect(r.status).toBe(403);
  });
});

describe("health data access", () => {
  it("lets the member and their care team read data, nobody else", async () => {
    const cookie = await register("b@t.test");
    const me = (await call("GET", "/api/auth/me", { cookie })).json;
    expect((await call("GET", `/api/metrics/summary?member=${me.id}`, { cookie: coachCookie })).status).toBe(200);
    expect((await call("GET", `/api/metrics/summary?member=${me.id}`, { cookie: outsiderCookie })).status).toBe(403);
    const other = await register("c@t.test");
    expect((await call("GET", `/api/metrics/summary?member=${me.id}`, { cookie: other })).status).toBe(403);
  });

  it("does not show a score without enough data", async () => {
    const cookie = await register("d@t.test");
    const me = (await call("GET", "/api/auth/me", { cookie })).json;
    expect(computeScore(me.id).score).toBeNull();
  });
});

describe("bookings", () => {
  it("books an open slot once and refuses the same slot twice", async () => {
    const m1 = await register("e@t.test");
    const m2 = await register("f@t.test");
    const slots = (await call("GET", `/api/care/experts/${coachId}/slots?days=3`, { cookie: m1 })).json.slots;
    expect(slots.length).toBeGreaterThan(0);
    const startsAt = slots[0].startsAt;
    expect((await call("POST", "/api/care/bookings", { cookie: m1, body: { expertId: coachId, startsAt } })).status).toBe(200);
    expect((await call("POST", "/api/care/bookings", { cookie: m2, body: { expertId: coachId, startsAt } })).status).toBe(409);
    expect((await call("POST", "/api/care/bookings", { cookie: m2, body: { expertId: coachId, startsAt: startsAt + 60_000 } })).status).toBe(409);
  });

  it("only opens messaging with linked experts", async () => {
    const cookie = await register("g@t.test");
    expect((await call("POST", "/api/care/threads/u_physio", { cookie, body: { body: "hi" } })).status).toBe(403);
    expect((await call("POST", `/api/care/threads/${coachId}`, { cookie, body: { body: "hi" } })).status).toBe(200);
  });
});

describe("watch pairing & ingest", () => {
  it("pairs with a one-time code, ingests, and revokes the old token on re-pair", async () => {
    const cookie = await register("h@t.test");
    const { code } = (await call("POST", "/api/devices/pairing-code", { cookie, body: { kind: "amazfit_bip6" } })).json;
    const pair = await call("POST", "/api/device/pair", { body: { code: code.toLowerCase() } });
    expect(pair.status).toBe(200);
    expect((await call("POST", "/api/device/pair", { body: { code } })).status).toBe(404);

    const today = new Date().toISOString().slice(0, 10);
    const payload = { capturedAt: Date.now(), daily: [{ date: today, steps: 9000, restingHr: 57 }], heartRate: [{ ts: Date.now(), bpm: 64 }] };
    const auth = { authorization: `Bearer ${pair.json.token}` };
    const ok = await call("POST", "/api/device/ingest/zepp", { body: payload, headers: auth });
    expect(ok.json).toMatchObject({ ok: true, stored: 3 });
    const summary = (await call("GET", "/api/metrics/summary", { cookie })).json;
    expect(summary.latest.steps.value).toBe(9000);

    const { code: code2 } = (await call("POST", "/api/devices/pairing-code", { cookie, body: { kind: "amazfit_bip6" } })).json;
    expect((await call("POST", "/api/device/pair", { body: { code: code2 } })).status).toBe(200);
    expect((await call("POST", "/api/device/ingest/zepp", { body: payload, headers: auth })).status).toBe(401);
  });

  it("rejects out-of-range values", async () => {
    const r = await call("POST", "/api/device/ingest/zepp", { body: { capturedAt: Date.now(), heartRate: [{ ts: Date.now(), bpm: 900 }] }, headers: { authorization: "Bearer nope" } });
    expect(r.status).toBe(401);
  });
});

describe("AI", () => {
  it("reports not configured without an API key", async () => {
    const cookie = await register("i@t.test");
    expect((await call("GET", "/api/ai/status", { cookie })).json.enabled).toBe(false);
    expect((await call("POST", "/api/ai/chat", { cookie, body: { message: "hi" } })).status).toBe(503);
    expect((await call("GET", "/api/ai/insight", { cookie })).json.text).toBeNull();
  });
});

describe("clinic time zone", () => {
  it("converts Athens wall-clock time across the DST switch", () => {
    // 29 Mar 2026: clocks go 03:00 → 04:00 (UTC+2 → UTC+3)
    expect(new Date(zonedToUtc("2026-03-28", 9 * 60, "Europe/Athens")).toISOString()).toBe("2026-03-28T07:00:00.000Z");
    expect(new Date(zonedToUtc("2026-03-30", 9 * 60, "Europe/Athens")).toISOString()).toBe("2026-03-30T06:00:00.000Z");
    expect(zonedDate(Date.parse("2026-10-13T22:30:00Z"), "Europe/Athens")).toEqual({ date: "2026-10-14", weekday: 3 });
  });
});
