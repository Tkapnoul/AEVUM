// Converts the "Health Auto Export – JSON+CSV" iOS app's REST payload into a HealthBatch.
// Format reference: HealthyApps/health-auto-export-server (server/src/models/Metric.ts):
//   { data: { metrics: [{ name, units, data: [{ date, qty, source } | { date, Min, Avg, Max } |
//     { date, systolic, diastolic } | { date, sleepStart, sleepEnd, inBedStart, inBedEnd, core, deep, rem, awake, inBed }] }] } }
// Dates look like "2024-02-06 07:12:00 +0200".
import type { HealthBatch } from "./ingest.js";
import type { MetricType } from "../../shared/metrics.js";

type Sample = Record<string, unknown> & { date?: string };
interface HaeMetric {
  name: string;
  units?: string;
  data?: Sample[];
}

export function parseHaeDate(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})?$/.exec(s.trim());
  const t = m ? Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${m[3]}:${m[4] ?? "00"}`) : Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** The member's local calendar date of a HAE timestamp (the offset is in the string). */
const localDate = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// name → [our metric, how to read daily totals vs samples]
const MAP: Record<string, { type: MetricType; daily?: boolean }> = {
  step_count: { type: "steps", daily: true },
  active_energy: { type: "active_calories", daily: true },
  walking_running_distance: { type: "distance", daily: true },
  apple_exercise_time: { type: "exercise_minutes", daily: true },
  resting_heart_rate: { type: "resting_hr" },
  heart_rate_variability: { type: "hrv" },
  vo2max: { type: "vo2max" },
  respiratory_rate: { type: "respiratory_rate" },
  blood_oxygen_saturation: { type: "spo2" },
  weight_body_mass: { type: "weight" },
  body_fat_percentage: { type: "body_fat" },
  blood_glucose: { type: "blood_glucose" },
};

function convert(type: MetricType, v: number, units: string): number {
  const u = units.toLowerCase();
  switch (type) {
    case "distance":
      return u === "km" ? v * 1000 : u === "mi" ? v * 1609.344 : v;
    case "active_calories":
      return u === "kj" ? v / 4.184 : v;
    case "weight":
      return u === "lb" || u === "lbs" ? v * 0.45359237 : v;
    case "blood_glucose":
      return u.includes("mmol") ? v * 18.016 : v;
    case "spo2":
    case "body_fat":
      return v <= 1 ? v * 100 : v; // some exports use fractions
    case "exercise_minutes":
      return u === "hr" || u === "h" ? v * 60 : v;
    default:
      return v;
  }
}

export function haeToBatch(body: unknown): HealthBatch {
  const metrics: HealthBatch["metrics"] = [];
  const sleep: HealthBatch["sleep"] = [];
  const list = ((body as { data?: { metrics?: HaeMetric[] } })?.data?.metrics ?? []) as HaeMetric[];

  for (const m of list) {
    const units = m.units ?? "";
    for (const s of m.data ?? []) {
      const t = parseHaeDate(s.date);
      if (t == null) continue;
      if (m.name === "heart_rate") {
        const avg = num(s.Avg) ?? num(s.qty);
        if (avg != null) metrics.push({ type: "heart_rate", ts: t, value: avg });
        continue;
      }
      if (m.name === "blood_pressure") {
        const sys = num(s.systolic);
        const dia = num(s.diastolic);
        if (sys != null) metrics.push({ type: "bp_systolic", ts: t, value: sys });
        if (dia != null) metrics.push({ type: "bp_diastolic", ts: t, value: dia });
        continue;
      }
      if (m.name === "sleep_analysis") {
        const toMin = (v: unknown) => {
          const n = num(v);
          return n == null ? null : units.toLowerCase().startsWith("min") ? n : n * 60; // default unit is hours
        };
        const core = toMin(s.core) ?? 0;
        const deep = toMin(s.deep) ?? 0;
        const rem = toMin(s.rem) ?? 0;
        const staged = core + deep + rem;
        const total = toMin(s.totalSleep) ?? toMin(s.asleep) ?? (staged || null);
        const date = localDate(s.sleepEnd) ?? localDate(s.date);
        if (!total || !date) continue;
        sleep.push({
          date,
          startTs: parseHaeDate(s.sleepStart),
          endTs: parseHaeDate(s.sleepEnd),
          totalMin: Math.round(Math.max(total, staged)),
          deepMin: staged ? Math.round(deep) : null,
          lightMin: staged ? Math.round(core) : null,
          remMin: staged ? Math.round(rem) : null,
          awakeMin: toMin(s.awake) != null ? Math.round(toMin(s.awake)!) : null,
          score: null,
        });
        continue;
      }
      const target = MAP[m.name];
      const q = num(s.qty);
      if (!target || q == null) continue;
      const value = convert(target.type, q, units);
      if (target.daily) {
        // Daily totals: keyed to the member's local date, matching how the app stores daily metrics.
        const d = localDate(s.date);
        if (d) metrics.push({ type: target.type, ts: Date.parse(`${d}T00:00:00Z`), value });
      } else metrics.push({ type: target.type, ts: t, value });
    }
  }
  return { metrics: sumDaily(metrics), sleep };
}

/** HAE can send hourly buckets for cumulative metrics; fold them into one value per day. */
function sumDaily(items: HealthBatch["metrics"]): HealthBatch["metrics"] {
  const daily = new Set<MetricType>(Object.values(MAP).filter((x) => x.daily).map((x) => x.type));
  const out: HealthBatch["metrics"] = [];
  const sums = new Map<string, number>();
  for (const m of items) {
    if (!daily.has(m.type)) out.push(m);
    else sums.set(`${m.type}|${m.ts}`, (sums.get(`${m.type}|${m.ts}`) ?? 0) + m.value);
  }
  for (const [k, v] of sums) {
    const [type, t] = k.split("|");
    out.push({ type: type as MetricType, ts: Number(t), value: Math.round(v * 10) / 10 });
  }
  return out;
}
