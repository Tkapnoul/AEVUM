import { z } from "zod";
import { get, run } from "../db.js";
import { newId, sha256, deviceToken } from "./ids.js";
import { upsertMetrics, upsertSleep, type MetricInput, type SleepInput } from "./metrics-store.js";
import { METRIC_BOUNDS, METRIC_TYPES, SOURCES, type MetricType, type SourceKind } from "../../shared/metrics.js";

const ts = z.number().int().min(1_000_000_000_000).max(4_000_000_000_000);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SleepSchema = z.object({
  date: dateStr, // local calendar date the member woke up
  startTs: ts.nullable().optional(),
  endTs: ts.nullable().optional(),
  totalMin: z.number().min(0).max(1440),
  deepMin: z.number().min(0).max(1440).nullable().optional(),
  lightMin: z.number().min(0).max(1440).nullable().optional(),
  remMin: z.number().min(0).max(1440).nullable().optional(),
  awakeMin: z.number().min(0).max(1440).nullable().optional(),
  score: z.number().min(0).max(100).nullable().optional(),
  stages: z.array(z.object({ stage: z.enum(["wake", "light", "deep", "rem"]), start: ts, end: ts })).max(400).optional(),
});

/** The one batch format every source is normalised to before storage. */
export const HealthBatch = z.object({
  metrics: z
    .array(z.object({ type: z.enum(METRIC_TYPES as [MetricType, ...MetricType[]]), ts, value: z.number() }))
    .max(50_000)
    .default([]),
  sleep: z.array(SleepSchema).max(400).default([]),
});
export type HealthBatch = z.infer<typeof HealthBatch>;

export function storeBatch(userId: string, source: SourceKind, batch: HealthBatch) {
  // Out-of-range values are almost always unit mix-ups (e.g. SpO₂ as 0.97); drop them rather than fail the batch.
  const ok: MetricInput[] = [];
  let dropped = 0;
  for (const m of batch.metrics) {
    const [lo, hi] = METRIC_BOUNDS[m.type];
    if (m.value < lo || m.value > hi) dropped++;
    else ok.push(m);
  }
  const stored = upsertMetrics(userId, source, ok);
  let nights = 0;
  for (const s of batch.sleep) {
    if (s.totalMin > 0) {
      upsertSleep(userId, source, s as SleepInput);
      nights++;
    }
  }
  return { stored, nights, dropped };
}

/** Sources that sync with the member's own session get one device row so the app can show "connected / last sync". */
export function touchSessionSource(userId: string, source: SourceKind) {
  const row = get<{ id: string }>("SELECT id FROM devices WHERE user_id = ? AND kind = ? AND revoked_at IS NULL", userId, source);
  if (row) run("UPDATE devices SET last_sync_at = ? WHERE id = ?", Date.now(), row.id);
  else
    run(
      "INSERT INTO devices (id, user_id, kind, name, token_hash, created_at, last_sync_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      newId("dev"), userId, source, SOURCES[source].name, sha256(deviceToken()), Date.now(), Date.now(),
    );
}

/** A long-lived token for an API-style source (Health Auto Export, Shortcuts…). Shown once. */
export function createApiToken(userId: string, source: SourceKind) {
  const token = deviceToken();
  run("UPDATE devices SET revoked_at = ? WHERE user_id = ? AND kind = ? AND revoked_at IS NULL", Date.now(), userId, source);
  run(
    "INSERT INTO devices (id, user_id, kind, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId("dev"), userId, source, SOURCES[source].name, sha256(token), Date.now(),
  );
  return token;
}

export function deviceFromAuthHeader(header: string | undefined) {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token.startsWith("aev_")) return undefined;
  return get<{ id: string; user_id: string; kind: SourceKind }>(
    "SELECT id, user_id, kind FROM devices WHERE token_hash = ? AND revoked_at IS NULL",
    sha256(token),
  );
}
