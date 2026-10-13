import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { all, get, run } from "../db.js";
import { aiProvider, config } from "../config.js";
import { completeJson } from "./free.js";
import { computeReport, engineInput, ENGINE_MODEL } from "../lib/bioengine.js";
import { anthropic, FALLBACK } from "./client.js";
import { dailySeries, mean } from "../lib/metrics-store.js";
import { latestLabs, phenoAgeFor, type PhenoAgeResult } from "../lib/phenoage.js";
import { METRICS, type MetricType } from "../../shared/metrics.js";
import { labDef } from "../../shared/labs.js";

export const SYSTEM_KEYS = ["cardiorespiratory", "cardiovascular", "metabolic", "body_composition", "sleep_recovery", "inflammation_blood", "activity"] as const;
const Level = z.enum(["low", "medium", "high"]);

export const BioAgeReport = z.object({
  overall_bio_age: z.number().describe("Estimated overall biological age in years, one decimal"),
  confidence: Level,
  headline: z.string().describe("One sentence, the main takeaway"),
  summary: z.string().describe("3–5 sentences explaining how the estimate was reached"),
  systems: z.array(
    z.object({
      key: z.enum(SYSTEM_KEYS),
      bio_age: z.number().nullable().describe("Equivalent age for this system, or null when there is no data for it"),
      confidence: Level,
      status: z.enum(["younger", "on_track", "older", "unknown"]),
      evidence: z.string().describe("1–2 sentences citing the actual numbers used"),
      key_metrics: z.array(z.object({ label: z.string(), value: z.string() })),
    }),
  ),
  drivers_younger: z.array(z.string()),
  drivers_older: z.array(z.string()),
  recommendations: z.array(
    z.object({
      title: z.string(),
      detail: z.string().describe("Specific and measurable, e.g. target numbers and frequency"),
      expected_effect: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
  data_gaps: z.array(z.object({ what: z.string(), why: z.string() })),
});
export type BioAgeReport = z.infer<typeof BioAgeReport>;

const SYSTEM = `You are the biological-age analyst of a longevity app. You estimate how old a member's body "behaves" compared with population norms, from wearable data, body measurements and blood tests.

Method:
- For every organ system with data, find the equivalent age: the age at which the member's values would be typical (≈50th percentile) for their sex, using published reference data you know well. Examples: VO2max vs the FRIEND / Cooper Institute registries; resting HR and HRV vs age norms (Apple Health HRV is SDNN, Health Connect is RMSSD — say which you assume); daily steps vs the mortality dose-response literature; sleep duration, regularity and stage proportions vs age norms; BMI and body-fat percentiles; blood pressure, ApoB/LDL, HbA1c, fasting glucose, triglyceride/HDL ratio and HOMA-IR (from glucose and insulin) vs age-stratified population data.
- "inflammation_blood": when a PhenoAge value is given, it comes from the validated Levine 2018 formula — use it as the anchor for this system and give it the largest single weight in the overall estimate. Otherwise use CRP, RDW, WBC, albumin, ferritin and similar markers.
- Overall bio age: a weighted combination of the systems you could estimate, weighting each by data quality and by how strongly that system predicts mortality (cardiorespiratory fitness and blood-based ageing weigh most). Systems without data are excluded, not guessed.
- Confidence: "high" only with recent blood work (incl. PhenoAge) plus ≥ 30 days of wearable data; wearable-only estimates are at most "medium"; under 14 days of data or a single system is "low".
- Never invent values. Use only numbers in the data. If something important is missing, list it under data_gaps with why it would sharpen the estimate.
- Keep estimates realistic: the overall estimate rarely differs from chronological age by more than 10–12 years; go further only when several systems agree.
- Recommendations: 3–5, the highest-leverage changes for THIS member's weakest systems, concrete (targets, frequency, duration), not generic advice. Medication changes are out of scope: send those to the doctor.

Write all text in the member's language as stated in the data. Be direct and specific; cite numbers.`;

const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

function metricStats(userId: string, type: MetricType) {
  const pts = dailySeries(userId, type, 90);
  if (!pts.length) return null;
  const vals = pts.map((p) => p.value);
  const last14 = pts.filter((p) => Date.parse(p.date) >= Date.now() - 14 * 86_400_000).map((p) => p.value);
  // Least-squares slope per 30 days, a rough trend signal.
  const xs = pts.map((p) => Date.parse(p.date) / 86_400_000);
  const mx = mean(xs)!;
  const my = mean(vals)!;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = den ? (xs.reduce((a, x, i) => a + (x - mx) * (vals[i] - my), 0) / den) * 30 : 0;
  return {
    unit: METRICS[type].unit,
    days_with_data: pts.length,
    mean_90d: r1(my),
    mean_14d: r1(mean(last14)),
    latest: r1(vals.at(-1)!),
    latest_date: pts.at(-1)!.date,
    trend_per_30d: r1(slope),
  };
}

export function chronoAge(birthDate: string | null, now = Date.now()) {
  return birthDate ? (now - Date.parse(birthDate)) / (365.2425 * 86_400_000) : null;
}

export function buildInput(userId: string) {
  const u = get<{ birth_date: string | null; sex: string | null; height_cm: number | null; locale: string; goals: string }>(
    "SELECT birth_date, sex, height_cm, locale, goals FROM users WHERE id = ?",
    userId,
  )!;
  const age = chronoAge(u.birth_date);
  const metrics: Record<string, unknown> = {};
  for (const t of Object.keys(METRICS) as MetricType[]) {
    const s = metricStats(userId, t);
    if (s) metrics[t] = s;
  }
  const weight = (metrics.weight as { latest: number } | undefined)?.latest;
  const sleep = all<{ total_min: number; deep_min: number | null; rem_min: number | null; start_ts: number | null }>(
    "SELECT total_min, deep_min, rem_min, start_ts FROM sleep_sessions WHERE user_id = ? AND date >= ? ORDER BY date",
    userId, new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10),
  );
  const starts = sleep.filter((s) => s.start_ts).map((s) => ((((s.start_ts! / 60_000) % 1440) + 1440 + 720) % 1440)); // minutes from noon, avoids midnight wrap
  const sd = (xs: number[]) => {
    const m = mean(xs);
    return m == null || xs.length < 2 ? null : Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  };
  const staged = sleep.filter((s) => s.deep_min != null && s.total_min > 0);
  const labs = [...latestLabs(userId).values()].map((l) => ({
    test: labDef(l.key)!.name.en,
    value: r1(l.value),
    unit: l.unit,
    ref: [l.ref_low, l.ref_high],
    date: new Date(l.taken_at).toISOString().slice(0, 10),
  }));
  const other = all<{ marker: string; value: number; unit: string; taken_at: number }>(
    "SELECT marker, value, unit, taken_at FROM labs WHERE user_id = ? AND marker_key IS NULL ORDER BY taken_at DESC LIMIT 40",
    userId,
  ).map((l) => ({ test: l.marker, value: l.value, unit: l.unit, date: new Date(l.taken_at).toISOString().slice(0, 10) }));
  const pheno: PhenoAgeResult = phenoAgeFor(userId, age);
  const previous = all<{ created_at: number; result: string }>(
    "SELECT created_at, result FROM bio_age_reports WHERE user_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 3",
    userId,
  ).map((r) => ({ date: new Date(r.created_at).toISOString().slice(0, 10), overall_bio_age: (JSON.parse(r.result) as BioAgeReport).overall_bio_age }));

  return {
    age,
    pheno,
    input: {
      member: {
        chronological_age: r1(age),
        sex: u.sex ?? "unknown",
        height_cm: u.height_cm,
        bmi: weight && u.height_cm ? r1(weight / (u.height_cm / 100) ** 2) : null,
        language: u.locale === "el" ? "Greek" : "English",
        goals: JSON.parse(u.goals),
      },
      wearable_and_body_metrics_90d: metrics,
      sleep_60d: sleep.length
        ? {
            nights: sleep.length,
            avg_total_min: r1(mean(sleep.map((s) => s.total_min))),
            avg_deep_pct: staged.length ? r1(mean(staged.map((s) => (100 * s.deep_min!) / s.total_min))) : null,
            avg_rem_pct: staged.length ? r1(mean(staged.filter((s) => s.rem_min != null).map((s) => (100 * s.rem_min!) / s.total_min))) : null,
            bedtime_sd_min: r1(sd(starts)),
          }
        : null,
      blood_tests_latest: labs,
      other_tests: other,
      phenoage: pheno.value != null ? { value: pheno.value, formula: "Levine 2018 PhenoAge" } : { value: null, missing_markers: pheno.missing },
      previous_estimates: previous,
    },
  };
}

const done = (reportId: string, report: BioAgeReport, model: string) =>
  run("UPDATE bio_age_reports SET status = 'done', result = ?, model = ?, finished_at = ? WHERE id = ?", JSON.stringify(report), model, Date.now(), reportId);

/**
 * Free provider: the validated rule-based results go in as anchors, the model writes the per-system estimate
 * and the narrative. If the model's JSON doesn't validate (free models sometimes drift), the rule-based
 * report is stored instead, so the member always gets a result.
 */
async function runFree(reportId: string, userId: string) {
  const rules = computeReport(engineInput(userId)!);
  const { input } = buildInput(userId);
  const anchors = {
    validated_ages: rules.systems.filter((x) => x.bio_age != null).map((x) => ({ system: x.key, age: x.bio_age, method: x.key === "cardiorespiratory" ? "fitness age from VO2max vs FRIEND registry medians" : "PhenoAge (Levine 2018)" })),
    rule_based_report: rules,
  };
  const report = await completeJson(
    [
      { role: "system", content: `${SYSTEM}\n\nThe app has already computed validated ages with fixed formulas (below). Treat them as anchors: copy those system ages unchanged and give them the largest weight in the overall estimate. Return all 7 systems.` },
      { role: "user", content: `Member data (JSON):\n${JSON.stringify(input)}\n\nApp-computed anchors (JSON):\n${JSON.stringify(anchors)}` },
    ],
    "bio_age_report",
    z.toJSONSchema(BioAgeReport),
    (x) => {
      const r = BioAgeReport.safeParse(x);
      return r.success && r.data.systems.length ? r.data : null;
    },
    12000,
  ).catch((err) => {
    console.error("[bioage] free provider failed, using rules", err);
    return null;
  });
  if (report) done(reportId, report, config.freeAi!.model);
  else done(reportId, rules, ENGINE_MODEL);
}

/** Runs one report to completion and stores the outcome. Never throws. */
export async function runBioAge(reportId: string, userId: string) {
  try {
    if (aiProvider === "free") return await runFree(reportId, userId);
    if (!anthropic) throw new Error("ai_not_configured");
    const { input } = buildInput(userId);
    const msg = await anthropic.beta.messages.parse({
      model: config.ai.model,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "high", format: betaZodOutputFormat(BioAgeReport) },
      messages: [{ role: "user", content: `Member data (JSON):\n${JSON.stringify(input)}` }],
      ...FALLBACK,
    });
    if (msg.stop_reason === "refusal") throw new Error("refusal");
    if (msg.stop_reason === "max_tokens" || !msg.parsed_output) throw new Error("incomplete_output");
    done(reportId, msg.parsed_output, msg.model);
  } catch (err) {
    console.error("[bioage] failed", err);
    run("UPDATE bio_age_reports SET status = 'error', error = ?, finished_at = ? WHERE id = ?", err instanceof Error ? err.message : "failed", Date.now(), reportId);
  }
}

// A restart kills in-flight jobs; don't leave them pending forever.
run("UPDATE bio_age_reports SET status = 'error', error = 'interrupted' WHERE status = 'pending'");
