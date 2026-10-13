// Imports an Apple Health "Export All Health Data" archive entirely on the phone:
// streams export.zip (or export.xml), keeps the last 12 months, reduces it to daily /
// hourly values and uploads only those. Works on any iPhone without installing anything.
import { Unzip, UnzipInflate } from "fflate";
import { api } from "./api";
import { sleepNights, type RawSleep } from "./sleepNights";
import type { MetricType } from "../../shared/metrics";

type Item = { type: MetricType; ts: number; value: number };

const KEEP_DAYS = 365;

// HealthKit identifier → how to reduce it.
const SUM: Record<string, MetricType> = {
  HKQuantityTypeIdentifierStepCount: "steps",
  HKQuantityTypeIdentifierDistanceWalkingRunning: "distance",
  HKQuantityTypeIdentifierActiveEnergyBurned: "active_calories",
  HKQuantityTypeIdentifierAppleExerciseTime: "exercise_minutes",
};
const DAILY_AVG: Record<string, MetricType> = {
  HKQuantityTypeIdentifierRestingHeartRate: "resting_hr",
  HKQuantityTypeIdentifierBodyMass: "weight",
  HKQuantityTypeIdentifierBodyFatPercentage: "body_fat",
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "hrv",
  HKQuantityTypeIdentifierOxygenSaturation: "spo2",
  HKQuantityTypeIdentifierRespiratoryRate: "respiratory_rate",
  HKQuantityTypeIdentifierVO2Max: "vo2max",
  HKQuantityTypeIdentifierBloodGlucose: "blood_glucose",
};
const EACH: Record<string, MetricType> = {
  HKQuantityTypeIdentifierBloodPressureSystolic: "bp_systolic",
  HKQuantityTypeIdentifierBloodPressureDiastolic: "bp_diastolic",
};
const SLEEP_STATE: Record<string, string> = {
  HKCategoryValueSleepAnalysisInBed: "inBed",
  HKCategoryValueSleepAnalysisAsleep: "asleep",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "asleep",
  HKCategoryValueSleepAnalysisAsleepCore: "light",
  HKCategoryValueSleepAnalysisAsleepDeep: "deep",
  HKCategoryValueSleepAnalysisAsleepREM: "rem",
  HKCategoryValueSleepAnalysisAwake: "awake",
};

/** "2024-01-15 07:32:10 +0200" → epoch ms */
export function parseAppleDate(s: string): number {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(s);
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : Date.parse(s);
}

function convert(type: MetricType, v: number, unit: string): number {
  const u = unit.toLowerCase();
  if (type === "distance") return u === "km" ? v * 1000 : u === "mi" ? v * 1609.344 : u === "m" ? v : v * 1000;
  if (type === "active_calories") return u === "kj" ? v / 4.184 : v; // "Cal"/"kcal"
  if (type === "weight") return u === "lb" ? v * 0.45359237 : v;
  if (type === "spo2" || type === "body_fat") return v <= 1.0001 ? v * 100 : v;
  if (type === "blood_glucose") return u.startsWith("mmol") ? v * 18.016 : v;
  return v;
}

export class AppleExportParser {
  private cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  // day/hour buckets: key → per-source sums (sum metrics) or [sum, n] (averages)
  private sums = new Map<string, Map<string, number>>();
  private avgs = new Map<string, [number, number]>();
  private each: Item[] = [];
  private sleep: RawSleep[] = [];
  private tail = "";
  private decoder = new TextDecoder();

  /** Feed raw bytes of export.xml. */
  push(chunk: Uint8Array, final = false) {
    const text = this.tail + this.decoder.decode(chunk, { stream: !final });
    let pos = 0;
    for (;;) {
      const i = text.indexOf("<Record ", pos);
      if (i < 0) {
        pos = Math.max(pos, text.length - 8); // keep a partial "<Record" prefix for the next chunk
        break;
      }
      const j = text.indexOf(">", i);
      if (j < 0) {
        pos = i;
        break;
      }
      this.record(text.slice(i + 8, j));
      pos = j + 1;
    }
    this.tail = final ? "" : text.slice(pos);
  }

  private record(attrs: string) {
    const a: Record<string, string> = {};
    for (const m of attrs.matchAll(/(\w+)="([^"]*)"/g)) a[m[1]] = m[2];
    const type = a.type;
    if (!type || !a.startDate) return;
    const start = parseAppleDate(a.startDate);
    if (!(start >= this.cutoff)) return;
    const source = a.sourceName ?? "?";

    if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      const state = SLEEP_STATE[a.value];
      if (state) this.sleep.push({ start, end: parseAppleDate(a.endDate), state, source });
      return;
    }
    const v = Number(a.value);
    if (!Number.isFinite(v)) return;
    const day = a.startDate.slice(0, 10); // local date as recorded
    if (SUM[type]) {
      const metric = SUM[type];
      const key = `${metric}|${day}`;
      const bySource = this.sums.get(key) ?? new Map<string, number>();
      bySource.set(source, (bySource.get(source) ?? 0) + convert(metric, v, a.unit ?? ""));
      this.sums.set(key, bySource);
    } else if (DAILY_AVG[type] || type === "HKQuantityTypeIdentifierHeartRate") {
      const metric = DAILY_AVG[type] ?? "heart_rate";
      // Heart rate keeps hourly resolution; everything else one value per day.
      const key = metric === "heart_rate" ? `${metric}|${a.startDate.slice(0, 13)}|${a.startDate.slice(20)}` : `${metric}|${day}`;
      const cur = this.avgs.get(key) ?? [0, 0];
      cur[0] += convert(metric, v, a.unit ?? "");
      cur[1]++;
      this.avgs.set(key, cur);
    } else if (EACH[type]) {
      this.each.push({ type: EACH[type], ts: start, value: v });
    }
  }

  result() {
    const metrics: Item[] = [...this.each];
    // Several sources (iPhone + watch) count the same steps: take the largest source, never the sum.
    for (const [key, bySource] of this.sums) {
      const [metric, day] = key.split("|");
      metrics.push({ type: metric as MetricType, ts: Date.parse(`${day}T00:00:00Z`), value: Math.round(Math.max(...bySource.values())) });
    }
    for (const [key, [sum, n]] of this.avgs) {
      const parts = key.split("|");
      const metric = parts[0] as MetricType;
      const value = Math.round((sum / n) * 10) / 10;
      if (metric === "heart_rate") {
        const [date, hour] = parts[1].split(" ");
        const offset = parts[2] ?? "+0000";
        metrics.push({ type: metric, ts: Date.parse(`${date}T${hour}:30:00${offset.slice(0, 3)}:${offset.slice(3)}`), value });
      } else if (metric === "resting_hr" || metric === "weight" || metric === "body_fat") {
        metrics.push({ type: metric, ts: Date.parse(`${parts[1]}T00:00:00Z`), value });
      } else {
        metrics.push({ type: metric, ts: Date.parse(`${parts[1]}T12:00:00Z`), value });
      }
    }
    return { metrics: metrics.filter((m) => Number.isFinite(m.ts)), sleep: sleepNights(this.sleep) };
  }
}

/** Reads export.zip / export.xml from a File, reporting MB processed. */
export async function importAppleExport(file: File, onProgress: (mb: number) => void) {
  const parser = new AppleExportParser();
  let processed = 0;
  const reader = file.stream().getReader();

  if (/\.xml$/i.test(file.name)) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(value);
      processed += value.length;
      onProgress(Math.round(processed / 1e6));
    }
    parser.push(new Uint8Array(), true);
  } else {
    let found = false;
    let finished = false;
    const unzip = new Unzip((entry) => {
      // apple_health_export/export.xml (not export_cda.xml)
      if (!/(^|\/)export\.xml$/.test(entry.name)) return;
      found = true;
      entry.ondata = (err, data, final) => {
        if (err) throw err;
        parser.push(data, final);
        processed += data.length;
        if (final) finished = true;
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      unzip.push(value, false);
      onProgress(Math.round(processed / 1e6));
      if (finished) break;
      await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }
    if (!finished) unzip.push(new Uint8Array(), true);
    if (!found) throw new Error("export.xml not found in archive");
  }

  const { metrics, sleep } = parser.result();
  for (let i = 0; i < Math.max(metrics.length, 1); i += 20_000) {
    await api("/metrics/ingest", { method: "POST", json: { source: "apple_health_export", metrics: metrics.slice(i, i + 20_000), sleep: i === 0 ? sleep : [] } });
  }
  return { metrics: metrics.length, nights: sleep.length };
}
