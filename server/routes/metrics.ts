import { Hono, type Context } from "hono";
import { z } from "zod";
import { all, get, run } from "../db.js";
import { requireUser, type AppEnv } from "../auth.js";
import { canViewMember } from "../lib/access.js";
import { dailySeries, lastSleep, latestValue, samplesForDay, upsertMetrics } from "../lib/metrics-store.js";
import { computeScore } from "../lib/score.js";
import { body, HttpError } from "../lib/validate.js";
import { newId } from "../lib/ids.js";
import { isoDate } from "../lib/time.js";
import { isMetricType, type MetricType } from "../../shared/metrics.js";

export const metricRoutes = new Hono<AppEnv>();
metricRoutes.use("*", requireUser);

/** `?member=<id>` lets care-team experts read a member's data. */
function subject(c: Context<AppEnv>) {
  const viewer = c.get("user");
  const memberId = c.req.query("member") ?? viewer.id;
  if (!canViewMember(viewer, memberId)) throw new HttpError(403, "forbidden");
  return memberId;
}

const TODAY_TYPES: MetricType[] = ["steps", "active_calories", "resting_hr", "heart_rate", "spo2", "stress", "pai", "weight"];

metricRoutes.get("/summary", (c) => {
  const userId = subject(c);
  const today = isoDate(Date.now());
  const latest = Object.fromEntries(
    TODAY_TYPES.map((t) => {
      const v = latestValue(userId, t);
      return [t, v ? { ...v, isToday: isoDate(v.ts) === today } : null];
    }),
  );
  const device = get<{ kind: string; last_sync_at: number | null }>(
    "SELECT kind, last_sync_at FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_sync_at DESC LIMIT 1",
    userId,
  );
  return c.json({ latest, sleep: lastSleep(userId) ?? null, score: computeScore(userId), device: device ?? null });
});

metricRoutes.get("/series/:type", (c) => {
  const userId = subject(c);
  const type = c.req.param("type");
  if (!isMetricType(type)) throw new HttpError(404, "unknown_metric");
  const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30)));
  return c.json({ type, days, points: dailySeries(userId, type, days) });
});

metricRoutes.get("/intraday/:type", (c) => {
  const userId = subject(c);
  const type = c.req.param("type");
  if (!isMetricType(type)) throw new HttpError(404, "unknown_metric");
  const date = c.req.query("date") ?? isoDate(Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "bad_date");
  return c.json({ type, date, samples: samplesForDay(userId, type, date) });
});

metricRoutes.get("/sleep", (c) => {
  const userId = subject(c);
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 14)));
  const rows = all<Record<string, unknown>>(
    "SELECT date, start_ts, end_ts, total_min, deep_min, light_min, rem_min, awake_min, score, source FROM sleep_sessions WHERE user_id = ? ORDER BY date DESC LIMIT ?",
    userId, days,
  );
  return c.json({ sessions: rows.reverse() });
});

// Manual entries (scale readings etc.) until more devices are integrated.
metricRoutes.post("/manual", async (c) => {
  const b = await body(
    c,
    z.object({ type: z.enum(["weight", "body_fat"]), value: z.number().positive().max(500), date: z.iso.date().optional() }),
  );
  const ts = b.date ? Date.parse(`${b.date}T00:00:00Z`) : Date.now();
  upsertMetrics(c.get("user").id, "manual", [{ type: b.type, ts, value: b.value }]);
  return c.json({ ok: true });
});

metricRoutes.get("/score", (c) => c.json(computeScore(subject(c))));

// ---- Lab results / biomarkers ----

metricRoutes.get("/labs", (c) => {
  const userId = subject(c);
  const rows = all<Record<string, unknown>>(
    `SELECT l.id, l.marker, l.value, l.unit, l.ref_low, l.ref_high, l.taken_at, l.note, u.name AS entered_by_name
     FROM labs l LEFT JOIN users u ON u.id = l.entered_by WHERE l.user_id = ? ORDER BY l.marker, l.taken_at`,
    userId,
  );
  return c.json({ labs: rows });
});

const LabInput = z.object({
  marker: z.string().trim().min(1).max(80),
  value: z.number(),
  unit: z.string().trim().max(20),
  refLow: z.number().nullable().optional(),
  refHigh: z.number().nullable().optional(),
  takenAt: z.iso.date(),
  note: z.string().max(1000).default(""),
});

metricRoutes.post("/labs", async (c) => {
  const userId = subject(c);
  const viewer = c.get("user");
  // Members may log their own results; among experts only doctors enter labs.
  if (viewer.id !== userId && viewer.role !== "doctor" && viewer.role !== "admin") throw new HttpError(403, "forbidden");
  const b = await body(c, LabInput);
  run(
    "INSERT INTO labs (id, user_id, marker, value, unit, ref_low, ref_high, taken_at, entered_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    newId("lab"), userId, b.marker, b.value, b.unit, b.refLow ?? null, b.refHigh ?? null, Date.parse(`${b.takenAt}T00:00:00Z`), viewer.id, b.note,
  );
  return c.json({ ok: true });
});
