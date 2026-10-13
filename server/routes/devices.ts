import { Hono } from "hono";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { requireUser, type AppEnv } from "../auth.js";
import { deviceToken, newId, pairingCode, sha256 } from "../lib/ids.js";
import { body, HttpError, rateLimit } from "../lib/validate.js";
import { upsertMetrics, upsertSleep, type MetricInput } from "../lib/metrics-store.js";

export const SUPPORTED_DEVICES = {
  amazfit_bip6: { name: "Amazfit Bip 6", source: "amazfit_bip6" },
} as const;
type DeviceKind = keyof typeof SUPPORTED_DEVICES;

const PAIRING_TTL_MS = 15 * 60_000;

// ---- Member-facing (session cookie) ----

export const deviceRoutes = new Hono<AppEnv>();

deviceRoutes.get("/", requireUser, (c) => {
  const rows = all(
    "SELECT id, kind, name, created_at, last_sync_at FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
    c.get("user").id,
  );
  return c.json({ devices: rows });
});

deviceRoutes.post("/pairing-code", requireUser, async (c) => {
  const b = await body(c, z.object({ kind: z.enum(Object.keys(SUPPORTED_DEVICES) as [DeviceKind]) }));
  const userId = c.get("user").id;
  rateLimit(`pair:${userId}`, 10, 3600_000);
  run("DELETE FROM pairing_codes WHERE user_id = ? OR expires_at < ?", userId, Date.now());
  let code = pairingCode();
  while (get("SELECT 1 FROM pairing_codes WHERE code = ?", code)) code = pairingCode();
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  run("INSERT INTO pairing_codes (code, user_id, kind, expires_at) VALUES (?, ?, ?, ?)", code, userId, b.kind, expiresAt);
  return c.json({ code, expiresAt });
});

deviceRoutes.delete("/:id", requireUser, (c) => {
  const res = run("UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL", Date.now(), c.req.param("id"), c.get("user").id);
  if (!res.changes) throw new HttpError(404, "not_found");
  return c.json({ ok: true });
});

// ---- Device-facing (no cookie; the watch's phone-side service calls these) ----

export const deviceApi = new Hono();

/** Exchange a 6-character pairing code for a long-lived device token. */
deviceApi.post("/pair", async (c) => {
  rateLimit(`claim:${c.req.header("x-forwarded-for") ?? "local"}`, 20, 15 * 60_000);
  const b = await body(c, z.object({ code: z.string().trim().toUpperCase().length(6), deviceName: z.string().max(80).optional() }));
  const token = deviceToken();
  const deviceId = newId("dev");
  tx(() => {
    const pc = get<{ user_id: string; kind: DeviceKind; expires_at: number; claimed_at: number | null }>(
      "SELECT user_id, kind, expires_at, claimed_at FROM pairing_codes WHERE code = ?",
      b.code,
    );
    if (!pc || pc.claimed_at || pc.expires_at < Date.now()) throw new HttpError(404, "invalid_or_expired_code");
    run("UPDATE pairing_codes SET claimed_at = ? WHERE code = ?", Date.now(), b.code);
    // One active watch of a kind per member: re-pairing replaces the old token.
    run("UPDATE devices SET revoked_at = ? WHERE user_id = ? AND kind = ? AND revoked_at IS NULL", Date.now(), pc.user_id, pc.kind);
    run(
      "INSERT INTO devices (id, user_id, kind, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      deviceId, pc.user_id, pc.kind, b.deviceName ?? SUPPORTED_DEVICES[pc.kind].name, sha256(token), Date.now(),
    );
  });
  return c.json({ token, deviceId });
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ts = z.number().int().min(1_500_000_000_000).max(4_000_000_000_000);

export const ZeppPayload = z.object({
  capturedAt: ts,
  daily: z
    .array(
      z.object({
        date: dateStr,
        steps: z.number().min(0).max(200_000).optional(),
        calories: z.number().min(0).max(20_000).optional(),
        distance: z.number().min(0).max(500_000).optional(),
        restingHr: z.number().min(20).max(200).optional(),
        pai: z.number().min(0).max(1000).optional(),
        stressAvg: z.number().min(0).max(100).optional(),
      }),
    )
    .max(31)
    .default([]),
  heartRate: z.array(z.object({ ts, bpm: z.number().min(25).max(250) })).max(2000).default([]),
  spo2: z.array(z.object({ ts, value: z.number().min(50).max(100) })).max(200).default([]),
  stress: z.array(z.object({ ts, value: z.number().min(0).max(100) })).max(400).default([]),
  sleep: z
    .object({
      date: dateStr,
      startTs: ts.nullable().optional(),
      endTs: ts.nullable().optional(),
      totalMin: z.number().min(0).max(1440),
      deepMin: z.number().min(0).max(1440).nullable().optional(),
      lightMin: z.number().min(0).max(1440).nullable().optional(),
      remMin: z.number().min(0).max(1440).nullable().optional(),
      awakeMin: z.number().min(0).max(1440).nullable().optional(),
      score: z.number().min(0).max(100).nullable().optional(),
      stages: z.array(z.object({ stage: z.enum(["wake", "light", "deep", "rem"]), start: ts, end: ts })).max(200).optional(),
    })
    .nullable()
    .optional(),
});

/** Batch upload from the AEVUM Zepp OS mini-app (see wearables/zepp-bip6). */
deviceApi.post("/ingest/zepp", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const device = token
    ? get<{ id: string; user_id: string; kind: DeviceKind }>(
        "SELECT id, user_id, kind FROM devices WHERE token_hash = ? AND revoked_at IS NULL",
        sha256(token),
      )
    : undefined;
  if (!device) return c.json({ error: "unauthorized" }, 401);
  rateLimit(`ingest:${device.id}`, 120, 3600_000);

  const p = await body(c, ZeppPayload);
  const source = SUPPORTED_DEVICES[device.kind].source;
  const items: MetricInput[] = [];
  for (const d of p.daily) {
    const day = Date.parse(`${d.date}T00:00:00Z`);
    if (d.steps != null) items.push({ type: "steps", ts: day, value: d.steps });
    if (d.calories != null) items.push({ type: "active_calories", ts: day, value: d.calories });
    if (d.distance != null) items.push({ type: "distance", ts: day, value: d.distance });
    if (d.restingHr) items.push({ type: "resting_hr", ts: day, value: d.restingHr });
    if (d.pai != null) items.push({ type: "pai", ts: day, value: d.pai });
    // Older days only come as a daily stress average; store it as a midday sample.
    if (d.stressAvg != null) items.push({ type: "stress", ts: day + 12 * 3600_000, value: d.stressAvg });
  }
  for (const s of p.heartRate) items.push({ type: "heart_rate", ts: s.ts, value: s.bpm });
  for (const s of p.spo2) items.push({ type: "spo2", ts: s.ts, value: s.value });
  for (const s of p.stress) items.push({ type: "stress", ts: s.ts, value: s.value });

  const stored = upsertMetrics(device.user_id, source, items);
  if (p.sleep && p.sleep.totalMin > 0) upsertSleep(device.user_id, source, p.sleep);
  run("UPDATE devices SET last_sync_at = ? WHERE id = ?", Date.now(), device.id);
  return c.json({ ok: true, stored, sleep: Boolean(p.sleep && p.sleep.totalMin > 0) });
});
