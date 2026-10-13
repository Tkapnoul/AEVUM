import type { MetricType } from "../../shared/metrics";

export function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

/** Value + unit for display; `fmtNum` comes from the i18n context. */
export function fmtMetric(type: MetricType, value: number, fmtNum: (n: number, d?: number) => string): { value: string; unit: string } {
  switch (type) {
    case "sleep_minutes":
    case "deep_sleep_minutes":
      return { value: fmtDuration(value), unit: "" };
    case "distance":
      return { value: fmtNum(value / 1000, 1), unit: "km" };
    case "steps":
    case "pai":
    case "sleep_score":
    case "stress":
      return { value: fmtNum(value), unit: type === "stress" ? "/100" : "" };
    case "heart_rate":
    case "resting_hr":
      return { value: fmtNum(value), unit: "bpm" };
    case "spo2":
    case "body_fat":
      return { value: fmtNum(value, type === "body_fat" ? 1 : 0), unit: "%" };
    case "active_calories":
      return { value: fmtNum(value), unit: "kcal" };
    case "weight":
      return { value: fmtNum(value, 1), unit: "kg" };
    case "hrv":
      return { value: fmtNum(value), unit: "ms" };
    case "vo2max":
      return { value: fmtNum(value, 1), unit: "ml/kg/min" };
    case "respiratory_rate":
      return { value: fmtNum(value, 1), unit: "/min" };
    case "bp_systolic":
    case "bp_diastolic":
      return { value: fmtNum(value), unit: "mmHg" };
    case "blood_glucose":
      return { value: fmtNum(value), unit: "mg/dL" };
    case "exercise_minutes":
      return { value: fmtNum(value), unit: "min" };
  }
}

export const timeAgo = (ts: number, locale: string) => {
  const rtf = new Intl.RelativeTimeFormat(locale === "el" ? "el" : "en", { numeric: "auto" });
  const s = (ts - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
};

export const initials = (name: string) =>
  name
    .replace(/^(Δρ\.|Dr\.?)\s*/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
