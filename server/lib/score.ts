import type { ScoreBreakdown } from "../../shared/metrics.js";
import { dailySeries, mean } from "./metrics-store.js";

const clamp = (x: number) => Math.max(0, Math.min(100, x));
const last = <T>(xs: T[], n: number) => xs.slice(Math.max(0, xs.length - n));

/**
 * AEVUM Score: a 0–100 wellness index of the last 7 days relative to the
 * member's own 30-day baseline. It is a coaching signal, not a diagnosis.
 *
 *  - sleep:    average nightly duration vs the 7–9 h band, plus the watch's sleep score when available
 *  - recovery: 7-day resting HR (lower = better) and HRV (higher = better) vs their 30-day baselines
 *  - activity: 7-day average steps vs 8,000/day
 *  - stress:   7-day average stress (0–100, lower = better)
 */
export function computeScore(userId: string, now = Date.now()): ScoreBreakdown {
  const sleep = dailySeries(userId, "sleep_minutes", 30, now);
  const sleepScore = dailySeries(userId, "sleep_score", 30, now);
  const rhr = dailySeries(userId, "resting_hr", 30, now);
  const steps = dailySeries(userId, "steps", 30, now);
  const stress = dailySeries(userId, "stress", 30, now);
  const hrv = dailySeries(userId, "hrv", 30, now);

  const sleepAvg = mean(last(sleep, 7).map((p) => p.value));
  const sleepScoreAvg = mean(last(sleepScore, 7).map((p) => p.value));
  let sleepC: number | null = null;
  if (sleepAvg != null) {
    const h = sleepAvg / 60;
    const durationScore = h >= 7 && h <= 9 ? 100 : h < 7 ? clamp(100 - (7 - h) * 30) : clamp(100 - (h - 9) * 20);
    sleepC = sleepScoreAvg != null ? Math.round(durationScore * 0.5 + sleepScoreAvg * 0.5) : Math.round(durationScore);
  }

  const recoveryParts: number[] = [];
  const rhr7 = mean(last(rhr, 7).map((p) => p.value));
  const rhr30 = mean(rhr.map((p) => p.value));
  if (rhr7 != null && rhr30 != null && rhr.length >= 7) {
    // Each bpm above baseline costs 8 points; below baseline earns up to +20.
    recoveryParts.push(clamp(80 - (rhr7 - rhr30) * 8));
  }
  const hrv7 = mean(last(hrv, 7).map((p) => p.value));
  const hrv30 = mean(hrv.map((p) => p.value));
  if (hrv7 != null && hrv30 && hrv.length >= 7) {
    // Each 1% above the personal HRV baseline earns 1.5 points.
    recoveryParts.push(clamp(80 + ((hrv7 - hrv30) / hrv30) * 150));
  }
  const recoveryC = recoveryParts.length ? Math.round(mean(recoveryParts)!) : null;

  const steps7 = mean(last(steps, 7).map((p) => p.value));
  const activityC = steps7 != null ? Math.round(clamp((steps7 / 8000) * 100)) : null;

  const stress7 = mean(last(stress, 7).map((p) => p.value));
  const stressC = stress7 != null ? Math.round(clamp(100 - stress7)) : null;

  const components: ScoreBreakdown["components"] = [
    { key: "sleep", score: sleepC },
    { key: "recovery", score: recoveryC },
    { key: "activity", score: activityC },
    { key: "stress", score: stressC },
  ];
  const weights = { sleep: 0.3, recovery: 0.25, activity: 0.25, stress: 0.2 };
  let wsum = 0;
  let total = 0;
  for (const c of components) {
    if (c.score == null) continue;
    total += c.score * weights[c.key];
    wsum += weights[c.key];
  }
  const basedOnDays = new Set([...sleep, ...steps, ...rhr, ...hrv].map((p) => p.date)).size;
  // Fewer than two signals or three days of data is not enough to say anything.
  const enough = components.filter((c) => c.score != null).length >= 2 && basedOnDays >= 3;
  return { score: enough ? Math.round(total / wsum) : null, components, basedOnDays };
}
