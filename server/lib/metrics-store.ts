import { all, get, db, tx } from "../db.js";
import { METRICS, type DailyPoint, type MetricType } from "../../shared/metrics.js";
import { DAY_MS, isoDate, startOfUtcDay } from "./time.js";

export interface MetricInput {
  type: MetricType;
  ts: number;
  value: number;
}

export interface SleepInput {
  date: string;
  startTs?: number | null;
  endTs?: number | null;
  totalMin: number;
  deepMin?: number | null;
  lightMin?: number | null;
  remMin?: number | null;
  awakeMin?: number | null;
  score?: number | null;
  stages?: unknown;
}

/** Insert or replace samples. Daily metrics are normalised to 00:00 UTC of their day. */
export function upsertMetrics(userId: string, source: string, items: MetricInput[]): number {
  const stmt = db.prepare(
    "INSERT INTO metrics (user_id, type, ts, value, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value",
  );
  return tx(() => {
    let n = 0;
    for (const m of items) {
      if (!Number.isFinite(m.value) || !Number.isFinite(m.ts)) continue;
      const ts = METRICS[m.type].kind === "daily" ? startOfUtcDay(m.ts) : Math.round(m.ts);
      stmt.run(userId, m.type, ts, m.value, source);
      n++;
    }
    return n;
  });
}

export function upsertSleep(userId: string, source: string, s: SleepInput) {
  tx(() => {
    db.prepare(
      `INSERT INTO sleep_sessions (user_id, date, start_ts, end_ts, total_min, deep_min, light_min, rem_min, awake_min, score, stages, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET start_ts = excluded.start_ts, end_ts = excluded.end_ts, total_min = excluded.total_min,
         deep_min = excluded.deep_min, light_min = excluded.light_min, rem_min = excluded.rem_min,
         awake_min = excluded.awake_min, score = excluded.score, stages = excluded.stages`,
    ).run(
      userId, s.date, s.startTs ?? null, s.endTs ?? null, s.totalMin, s.deepMin ?? null, s.lightMin ?? null,
      s.remMin ?? null, s.awakeMin ?? null, s.score ?? null, s.stages ? JSON.stringify(s.stages) : null, source,
    );
    // Mirror the headline numbers into the metric series so charts/score treat sleep like any other metric.
    const ts = Date.parse(`${s.date}T00:00:00Z`);
    const mirror: MetricInput[] = [{ type: "sleep_minutes", ts, value: s.totalMin }];
    if (s.deepMin != null) mirror.push({ type: "deep_sleep_minutes", ts, value: s.deepMin });
    if (s.score != null && s.score > 0) mirror.push({ type: "sleep_score", ts, value: s.score });
    const stmt = db.prepare(
      "INSERT INTO metrics (user_id, type, ts, value, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value",
    );
    for (const m of mirror) stmt.run(userId, m.type, m.ts, m.value, source);
  });
}

/**
 * One point per day. When several sources report the same daily metric the
 * highest value wins for counters (steps etc.) — wearables only under-count.
 */
export function dailySeries(userId: string, type: MetricType, days: number, now = Date.now()): DailyPoint[] {
  const from = startOfUtcDay(now) - (days - 1) * DAY_MS;
  const def = METRICS[type];
  if (def.kind === "daily") {
    const agg = def.higherIsBetter === true || type === "distance" ? "MAX(value)" : "AVG(value)";
    return all<{ ts: number; value: number }>(
      `SELECT ts, ${agg} AS value FROM metrics WHERE user_id = ? AND type = ? AND ts >= ? GROUP BY ts ORDER BY ts`,
      userId, type, from,
    ).map((r) => ({ date: isoDate(r.ts), value: r.value }));
  }
  return all<{ day: number; value: number; min: number; max: number; count: number }>(
    `SELECT (ts / ${DAY_MS}) * ${DAY_MS} AS day, AVG(value) AS value, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS count
     FROM metrics WHERE user_id = ? AND type = ? AND ts >= ? GROUP BY day ORDER BY day`,
    userId, type, from,
  ).map((r) => ({ date: isoDate(r.day), value: r.value, min: r.min, max: r.max, count: r.count }));
}

/** Raw samples for one UTC day (used for the intraday heart-rate chart). */
export function samplesForDay(userId: string, type: MetricType, date: string) {
  const from = Date.parse(`${date}T00:00:00Z`);
  return all<{ ts: number; value: number }>(
    "SELECT ts, AVG(value) AS value FROM metrics WHERE user_id = ? AND type = ? AND ts >= ? AND ts < ? GROUP BY ts ORDER BY ts",
    userId, type, from, from + DAY_MS,
  );
}

export function latestValue(userId: string, type: MetricType): { ts: number; value: number } | undefined {
  return get("SELECT ts, value FROM metrics WHERE user_id = ? AND type = ? ORDER BY ts DESC LIMIT 1", userId, type);
}

export function lastSleep(userId: string) {
  const row = get<{
    date: string; start_ts: number | null; end_ts: number | null; total_min: number; deep_min: number | null;
    light_min: number | null; rem_min: number | null; awake_min: number | null; score: number | null; stages: string | null; source: string;
  }>("SELECT * FROM sleep_sessions WHERE user_id = ? ORDER BY date DESC LIMIT 1", userId);
  return row ? { ...row, stages: row.stages ? JSON.parse(row.stages) : null } : undefined;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
