// Reads Apple Health (iOS) or Health Connect (Android) through @capgo/capacitor-health and
// uploads a normalised batch to /api/metrics/ingest. Any watch or ring whose companion app
// writes to those stores (Apple Watch, Garmin, Samsung, Fitbit/Pixel, Amazfit/Zepp, Oura,
// Whoop, Withings, Polar, Coros, Xiaomi…) is covered.
import { Health, type HealthDataType, type HealthSample } from "@capgo/capacitor-health";
import { Preferences } from "@capacitor/preferences";
import { api } from "./api";
import { platform } from "./native";
import type { MetricType } from "../../shared/metrics";
import { sleepNights, type RawSleep } from "./sleepNights";

type MetricItem = { type: MetricType; ts: number; value: number };

const DAY = 86_400_000;
const FIRST_SYNC_DAYS = 90;
const LAST_SYNC_KEY = "healthLastSync";

const READ_TYPES = (): HealthDataType[] => [
  "steps", "distance", "calories", "heartRate", "restingHeartRate", "heartRateVariability", "vo2Max",
  "oxygenSaturation", "respiratoryRate", "sleep", "weight", "bodyFat", "bloodPressure", "bloodGlucose",
  ...(platform === "ios" ? (["exerciseTime"] as HealthDataType[]) : []),
];

export const sourceKind = () => (platform === "ios" ? "apple_health" : "health_connect") as "apple_health" | "health_connect";

export async function healthAvailable() {
  return Health.isAvailable();
}

export async function connectHealth() {
  return Health.requestAuthorization({ read: READ_TYPES(), write: [], requestHistoryAccess: true });
}

export async function openHealthSettings() {
  await Health.openHealthConnectSettings();
}

/** The member's local calendar date of an instant, as YYYY-MM-DD. */
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Daily metrics are stored at 00:00 UTC of the member's local date (server convention). */
const dayKey = (iso: string) => Date.parse(`${localDate(new Date(iso))}T00:00:00Z`);
const pct = (v: number) => (v <= 1.0001 ? v * 100 : v); // HealthKit percent can be a 0–1 fraction

async function daily(dataType: HealthDataType, aggregation: "sum" | "average", type: MetricType, start: Date, end: Date, out: MetricItem[]) {
  try {
    const { samples } = await Health.queryAggregated({ dataType, startDate: start.toISOString(), endDate: end.toISOString(), bucket: "day", aggregation });
    for (const s of samples) if (Number.isFinite(s.value) && s.value > 0) out.push({ type, ts: dayKey(s.startDate), value: Math.round(s.value * 10) / 10 });
  } catch {
    /* type not permitted or not available on this device */
  }
}

async function samples(dataType: HealthDataType, start: Date, end: Date): Promise<HealthSample[]> {
  try {
    const res = await Health.readSamples({ dataType, startDate: start.toISOString(), endDate: end.toISOString(), limit: 20_000, ascending: true });
    return res.samples;
  } catch {
    return [];
  }
}

export interface SyncResult {
  metrics: number;
  nights: number;
  from: Date;
}

/** Syncs everything since the last sync (or the last 90 days the first time). */
export async function syncHealth(opts: { full?: boolean } = {}): Promise<SyncResult> {
  const end = new Date();
  const last = Number((await Preferences.get({ key: LAST_SYNC_KEY })).value ?? 0);
  // Re-read two days before the last sync: today's and yesterday's totals keep growing.
  const start = new Date(!opts.full && last ? last - 2 * DAY : end.getTime() - FIRST_SYNC_DAYS * DAY);
  start.setHours(0, 0, 0, 0);

  const metrics: MetricItem[] = [];
  await daily("steps", "sum", "steps", start, end, metrics);
  await daily("distance", "sum", "distance", start, end, metrics);
  await daily("calories", "sum", "active_calories", start, end, metrics);
  await daily("restingHeartRate", "average", "resting_hr", start, end, metrics);
  await daily("weight", "average", "weight", start, end, metrics);
  if (platform === "ios") await daily("exerciseTime", "sum", "exercise_minutes", start, end, metrics);

  try {
    const { samples: hr } = await Health.queryAggregated({ dataType: "heartRate", startDate: start.toISOString(), endDate: end.toISOString(), bucket: "hour", aggregation: "average" });
    for (const s of hr) if (s.value > 0) metrics.push({ type: "heart_rate", ts: Date.parse(s.startDate) + 30 * 60_000, value: Math.round(s.value) });
  } catch {
    /* not permitted */
  }

  const pointSeries: [HealthDataType, MetricType, (v: number) => number][] = [
    ["heartRateVariability", "hrv", (v) => v],
    ["vo2Max", "vo2max", (v) => v],
    ["oxygenSaturation", "spo2", pct],
    ["respiratoryRate", "respiratory_rate", (v) => v],
    ["bodyFat", "body_fat", pct],
    ["bloodGlucose", "blood_glucose", (v) => v],
  ];
  for (const [dataType, type, f] of pointSeries) {
    for (const s of await samples(dataType, start, end)) metrics.push({ type, ts: Date.parse(s.startDate), value: Math.round(f(s.value) * 10) / 10 });
  }
  for (const s of await samples("bloodPressure", start, end)) {
    const t = Date.parse(s.startDate);
    if (s.systolic) metrics.push({ type: "bp_systolic", ts: t, value: s.systolic });
    if (s.diastolic) metrics.push({ type: "bp_diastolic", ts: t, value: s.diastolic });
  }
  // Sleep that ended inside the window may have started the evening before.
  const rawSleep: RawSleep[] = [];
  for (const s of await samples("sleep", new Date(start.getTime() - DAY), end)) {
    const source = s.sourceId || s.sourceName || "unknown";
    if (s.stages?.length) for (const st of s.stages) rawSleep.push({ start: Date.parse(st.startDate), end: Date.parse(st.endDate), state: st.stage, source });
    else rawSleep.push({ start: Date.parse(s.startDate), end: Date.parse(s.endDate), state: s.sleepState ?? "asleep", source });
  }
  const sleep = sleepNights(rawSleep);

  const source = sourceKind();
  for (let i = 0; i < Math.max(metrics.length, 1); i += 20_000) {
    await api("/metrics/ingest", { method: "POST", json: { source, metrics: metrics.slice(i, i + 20_000), sleep: i === 0 ? sleep : [] } });
  }
  await Preferences.set({ key: LAST_SYNC_KEY, value: String(end.getTime()) });
  return { metrics: metrics.length, nights: sleep.length, from: start };
}

export async function lastHealthSync(): Promise<number | null> {
  const v = (await Preferences.get({ key: LAST_SYNC_KEY })).value;
  return v ? Number(v) : null;
}
