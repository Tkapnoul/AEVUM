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
  | "body_fat"
  | "hrv"
  | "vo2max"
  | "respiratory_rate"
  | "bp_systolic"
  | "bp_diastolic"
  | "blood_glucose"
  | "exercise_minutes";

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
  // Apple Health reports SDNN, Health Connect RMSSD; both are stored as-is under one series.
  hrv: { type: "hrv", kind: "sample", unit: "ms", higherIsBetter: true, decimals: 0 },
  vo2max: { type: "vo2max", kind: "sample", unit: "ml/kg/min", higherIsBetter: true, decimals: 1 },
  respiratory_rate: { type: "respiratory_rate", kind: "sample", unit: "br/min", higherIsBetter: null, decimals: 1 },
  bp_systolic: { type: "bp_systolic", kind: "sample", unit: "mmHg", higherIsBetter: false, decimals: 0 },
  bp_diastolic: { type: "bp_diastolic", kind: "sample", unit: "mmHg", higherIsBetter: false, decimals: 0 },
  blood_glucose: { type: "blood_glucose", kind: "sample", unit: "mg/dL", higherIsBetter: null, decimals: 0 },
  exercise_minutes: { type: "exercise_minutes", kind: "daily", unit: "min", higherIsBetter: true, decimals: 0 },
};

/** Plausible physiological bounds; anything outside is dropped at ingest as a sensor/unit error. */
export const METRIC_BOUNDS: Record<MetricType, [number, number]> = {
  steps: [0, 200_000],
  active_calories: [0, 20_000],
  distance: [0, 500_000],
  heart_rate: [25, 250],
  resting_hr: [25, 150],
  spo2: [50, 100],
  stress: [0, 100],
  pai: [0, 1000],
  sleep_minutes: [0, 1440],
  deep_sleep_minutes: [0, 1440],
  sleep_score: [0, 100],
  weight: [20, 400],
  body_fat: [2, 75],
  hrv: [1, 400],
  vo2max: [5, 95],
  respiratory_rate: [4, 60],
  bp_systolic: [60, 260],
  bp_diastolic: [30, 160],
  blood_glucose: [20, 600],
  exercise_minutes: [0, 1440],
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

/** Where data came from. Native app sources sync with the member's session; the rest use device tokens. */
export const SOURCES = {
  amazfit_bip6: { name: "Amazfit Bip 6 (Zepp OS app)", token: "pairing" },
  apple_health: { name: "Apple Health", token: "session" },
  health_connect: { name: "Health Connect", token: "session" },
  apple_health_export: { name: "Apple Health export", token: "session" },
  health_auto_export: { name: "Health Auto Export (iPhone)", token: "api" },
  api: { name: "API / Shortcuts", token: "api" },
} as const;
export type SourceKind = keyof typeof SOURCES;
export const EXPERT_ROLES: Role[] = ["coach", "doctor", "nutritionist", "physio"];

export interface ScoreBreakdown {
  score: number | null;
  components: { key: "sleep" | "recovery" | "activity" | "stress"; score: number | null }[];
  basedOnDays: number;
}
