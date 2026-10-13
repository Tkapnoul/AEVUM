// Metric catalogue shared by the API, the PWA and the AI context builder.
// `kind: "daily"` metrics have one value per day; `kind: "sample"` metrics are
// time series that get aggregated (avg/min/max) per day.

export type MetricType =
  | "steps"
  | "active_calories"
  | "distance"
  | "heart_rate"
  | "resting_hr"
  | "spo2"
  | "stress"
  | "pai"
  | "sleep_minutes"
  | "deep_sleep_minutes"
  | "sleep_score"
  | "weight"
  | "body_fat";

export interface MetricDef {
  type: MetricType;
  kind: "daily" | "sample";
  unit: string;
  /** Higher is better (true), lower is better (false), or neither (null). */
  higherIsBetter: boolean | null;
  decimals: number;
}

export const METRICS: Record<MetricType, MetricDef> = {
  steps: { type: "steps", kind: "daily", unit: "", higherIsBetter: true, decimals: 0 },
  active_calories: { type: "active_calories", kind: "daily", unit: "kcal", higherIsBetter: true, decimals: 0 },
  distance: { type: "distance", kind: "daily", unit: "m", higherIsBetter: true, decimals: 0 },
  heart_rate: { type: "heart_rate", kind: "sample", unit: "bpm", higherIsBetter: null, decimals: 0 },
  resting_hr: { type: "resting_hr", kind: "daily", unit: "bpm", higherIsBetter: false, decimals: 0 },
  spo2: { type: "spo2", kind: "sample", unit: "%", higherIsBetter: true, decimals: 0 },
  stress: { type: "stress", kind: "sample", unit: "", higherIsBetter: false, decimals: 0 },
  pai: { type: "pai", kind: "daily", unit: "", higherIsBetter: true, decimals: 0 },
  sleep_minutes: { type: "sleep_minutes", kind: "daily", unit: "min", higherIsBetter: null, decimals: 0 },
  deep_sleep_minutes: { type: "deep_sleep_minutes", kind: "daily", unit: "min", higherIsBetter: true, decimals: 0 },
  sleep_score: { type: "sleep_score", kind: "daily", unit: "", higherIsBetter: true, decimals: 0 },
  weight: { type: "weight", kind: "daily", unit: "kg", higherIsBetter: null, decimals: 1 },
  body_fat: { type: "body_fat", kind: "daily", unit: "%", higherIsBetter: null, decimals: 1 },
};

export const METRIC_TYPES = Object.keys(METRICS) as MetricType[];

export function isMetricType(v: string): v is MetricType {
  return v in METRICS;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  value: number; // daily value, or average for sample metrics
  min?: number;
  max?: number;
  count?: number;
}

export type Role = "member" | "coach" | "doctor" | "nutritionist" | "physio" | "admin";
export const EXPERT_ROLES: Role[] = ["coach", "doctor", "nutritionist", "physio"];

export interface ScoreBreakdown {
  score: number | null;
  components: { key: "sleep" | "recovery" | "activity" | "stress"; score: number | null }[];
  basedOnDays: number;
}
