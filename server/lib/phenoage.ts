import { all } from "../db.js";
import { labDef, matchLabKey, toCanonical, type LabKey } from "../../shared/labs.js";

// Levine ME et al., "An epigenetic biomarker of aging for lifespan and healthspan", Aging 2018.
// Phenotypic Age from chronological age and nine blood markers (NHANES III-trained mortality model).

export const PHENOAGE_MARKERS: LabKey[] = ["albumin", "creatinine", "glucose", "crp", "lymphocyte_pct", "mcv", "rdw", "alp", "wbc"];

export interface PhenoAgeInput {
  age: number;
  albumin: number; // g/dL (canonical) → g/L inside
  creatinine: number; // mg/dL → µmol/L
  glucose: number; // mg/dL → mmol/L
  crp: number; // mg/L → mg/dL, then ln
  lymphocyte_pct: number; // %
  mcv: number; // fL
  rdw: number; // %
  alp: number; // U/L
  wbc: number; // 10³/µL
}

export function phenoAge(x: PhenoAgeInput): number {
  const crpMgDl = Math.max(x.crp, 0.01) / 10; // ln(0) guard: hs-CRP below detection limit
  const xb =
    -19.907 -
    0.0336 * (x.albumin * 10) +
    0.0095 * (x.creatinine * 88.4) +
    0.1953 * (x.glucose / 18.016) +
    0.0954 * Math.log(crpMgDl) -
    0.012 * x.lymphocyte_pct +
    0.0268 * x.mcv +
    0.3306 * x.rdw +
    0.00188 * x.alp +
    0.0554 * x.wbc +
    0.0804 * x.age;
  const gamma = 0.0076927;
  const mortality = 1 - Math.exp((-Math.exp(xb) * (Math.exp(120 * gamma) - 1)) / gamma);
  return 141.50225 + Math.log(-0.00553 * Math.log(1 - mortality)) / 0.090165;
}

export interface LatestLab {
  key: LabKey;
  value: number; // canonical unit
  unit: string;
  taken_at: number;
  ref_low: number | null;
  ref_high: number | null;
  marker: string;
}

/** Latest result per catalogue marker, converted to canonical units. */
export function latestLabs(userId: string): Map<LabKey, LatestLab> {
  const rows = all<{ marker: string; marker_key: string | null; value: number; unit: string; taken_at: number; ref_low: number | null; ref_high: number | null }>(
    "SELECT marker, marker_key, value, unit, taken_at, ref_low, ref_high FROM labs WHERE user_id = ? ORDER BY taken_at",
    userId,
  );
  const out = new Map<LabKey, LatestLab>();
  for (const r of rows) {
    const key = (r.marker_key as LabKey | null) ?? matchLabKey(r.marker);
    if (!key) continue;
    const v = toCanonical(key, r.value, r.unit);
    if (v == null) continue;
    out.set(key, { key, value: v, unit: labDef(key)!.unit, taken_at: r.taken_at, ref_low: r.ref_low, ref_high: r.ref_high, marker: r.marker });
  }
  return out;
}

export interface PhenoAgeResult {
  value: number | null;
  missing: LabKey[];
  /** Spread between the oldest and newest marker used, in days. */
  spanDays: number | null;
  takenAt: number | null;
}

const MAX_SPAN_DAYS = 120; // markers from different blood draws months apart don't describe one state

export function phenoAgeFor(userId: string, age: number | null): PhenoAgeResult {
  const labs = latestLabs(userId);
  const missing = PHENOAGE_MARKERS.filter((k) => !labs.has(k));
  if (age == null || missing.length) return { value: null, missing, spanDays: null, takenAt: null };
  const used = PHENOAGE_MARKERS.map((k) => labs.get(k)!);
  const times = used.map((l) => l.taken_at);
  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  if (spanDays > MAX_SPAN_DAYS) return { value: null, missing: [], spanDays, takenAt: null };
  const v = Object.fromEntries(used.map((l) => [l.key, l.value])) as Record<LabKey, number>;
  const value = phenoAge({
    age,
    albumin: v.albumin,
    creatinine: v.creatinine,
    glucose: v.glucose,
    crp: v.crp,
    lymphocyte_pct: v.lymphocyte_pct,
    mcv: v.mcv,
    rdw: v.rdw,
    alp: v.alp,
    wbc: v.wbc,
  });
  return { value: Number.isFinite(value) ? Math.round(value * 10) / 10 : null, missing: [], spanDays, takenAt: Math.max(...times) };
}
