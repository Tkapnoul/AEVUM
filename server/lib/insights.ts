import { get } from "../db.js";
import { dailySeries, lastSleep, mean } from "./metrics-store.js";
import { DAY_MS, isoDate } from "./time.js";

// Data-grounded observations without an LLM: each rule compares a recent value with the member's own
// baseline or a guideline range and pairs it with one concrete action. Used for the Today insight and
// the analysis screen when no ANTHROPIC_API_KEY is configured.

export interface Insight {
  topic: "sleep" | "recovery" | "activity" | "body" | "bioage" | "data";
  tone: "good" | "neutral" | "warn";
  title: string;
  text: string;
  /** How notable it is; the Today card shows the highest. */
  weight: number;
}

type Locale = "el" | "en";
const n0 = (x: number, l: Locale) => Math.round(x).toLocaleString(l === "el" ? "el-GR" : "en-US");
const n1 = (x: number, l: Locale) => (Math.round(x * 10) / 10).toLocaleString(l === "el" ? "el-GR" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hm = (min: number, l: Locale) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return l === "el" ? `${h} ώρ. ${m} λεπ.` : `${h}h ${m}m`;
};
const avg = (pts: { value: number }[]) => mean(pts.map((p) => p.value));

export function insights(userId: string, now = Date.now()): Insight[] {
  const l: Locale = get<{ locale: string }>("SELECT locale FROM users WHERE id = ?", userId)?.locale === "en" ? "en" : "el";
  const el = l === "el";
  const out: Insight[] = [];

  // Sleep: last night vs the 7–9 h band and the 30-day average.
  const night = lastSleep(userId);
  const sleep30 = dailySeries(userId, "sleep_minutes", 30, now);
  if (night && Date.parse(night.date) >= now - 2 * DAY_MS) {
    const base = avg(sleep30);
    const t = night.total_min;
    const deepPct = night.deep_min != null && t > 0 ? (100 * night.deep_min) / t : null;
    if (t < 360) {
      out.push({
        topic: "sleep", tone: "warn", weight: 3 + (360 - t) / 60,
        title: el ? "Λίγος ύπνος" : "Short night",
        text: el
          ? `Κοιμήθηκες ${hm(t, l)}${base ? ` (μ.ό. 30 ημερών ${hm(base, l)})` : ""}. Σήμερα κράτα την προπόνηση ήπια και πήγαινε για ύπνο 30–45 λεπτά νωρίτερα.`
          : `You slept ${hm(t, l)}${base ? ` (30-day average ${hm(base, l)})` : ""}. Keep training easy today and go to bed 30–45 minutes earlier.`,
      });
    } else if (t >= 420 && t <= 540) {
      out.push({
        topic: "sleep", tone: "good", weight: 1,
        title: el ? "Καλός ύπνος" : "Good night",
        text: el
          ? `${hm(t, l)} ύπνου${deepPct != null ? `, ${n0(deepPct, l)}% βαθύς` : ""} — μέσα στο ιδανικό 7–9 ωρών. Κράτα την ίδια ώρα ύπνου απόψε.`
          : `${hm(t, l)} of sleep${deepPct != null ? `, ${n0(deepPct, l)}% deep` : ""} — inside the 7–9 h range. Keep the same bedtime tonight.`,
      });
    } else {
      out.push({
        topic: "sleep", tone: "neutral", weight: 1.5,
        title: el ? "Ύπνος" : "Sleep",
        text: el
          ? `${hm(t, l)} ύπνου. Στόχος 7–9 ώρες με σταθερή ώρα ύπνου και ξυπνήματος.`
          : `${hm(t, l)} of sleep. Aim for 7–9 hours with a consistent bed and wake time.`,
      });
    }
  }

  // Recovery: resting HR and HRV, last 3 days vs 30-day baseline.
  const rhr = dailySeries(userId, "resting_hr", 30, now);
  const hrv = dailySeries(userId, "hrv", 30, now);
  const rhr3 = avg(rhr.slice(-3));
  const rhrBase = avg(rhr);
  const hrv3 = avg(hrv.slice(-3));
  const hrvBase = avg(hrv);
  const rhrUp = rhr.length >= 10 && rhr3 != null && rhrBase != null ? rhr3 - rhrBase : null;
  const hrvDrop = hrv.length >= 10 && hrv3 != null && hrvBase ? ((hrv3 - hrvBase) / hrvBase) * 100 : null;
  if ((rhrUp != null && rhrUp >= 3) || (hrvDrop != null && hrvDrop <= -12)) {
    const parts = [
      rhrUp != null && rhrUp >= 3 ? (el ? `παλμοί ηρεμίας +${n0(rhrUp, l)} bpm` : `resting HR +${n0(rhrUp, l)} bpm`) : null,
      hrvDrop != null && hrvDrop <= -12 ? (el ? `HRV ${n0(hrvDrop, l)}%` : `HRV ${n0(hrvDrop, l)}%`) : null,
    ].filter(Boolean);
    out.push({
      topic: "recovery", tone: "warn", weight: 3 + Math.max(rhrUp ?? 0, -(hrvDrop ?? 0) / 4),
      title: el ? "Η αποκατάσταση υστερεί" : "Recovery is lagging",
      text: el
        ? `Τις τελευταίες 3 μέρες: ${parts.join(", ")} έναντι της βάσης σου. Συχνά σημαίνει κούραση, άγχος, αλκοόλ ή αρχή ίωσης — προτίμησε ελαφριά κίνηση και ύπνο σήμερα.`
        : `Last 3 days: ${parts.join(", ")} vs your baseline. Often fatigue, stress, alcohol or an oncoming bug — favour light movement and sleep today.`,
    });
  } else if (rhrUp != null || hrvDrop != null) {
    const good = (rhrUp != null && rhrUp <= -2) || (hrvDrop != null && hrvDrop >= 8);
    out.push({
      topic: "recovery", tone: good ? "good" : "neutral", weight: good ? 1.5 : 0.5,
      title: el ? (good ? "Καλή αποκατάσταση" : "Σταθερή αποκατάσταση") : good ? "Well recovered" : "Steady recovery",
      text: el
        ? `${rhr3 != null ? `Παλμοί ηρεμίας ${n0(rhr3, l)} bpm (βάση ${n0(rhrBase!, l)})` : ""}${rhr3 != null && hrv3 != null ? ", " : ""}${hrv3 != null ? `HRV ${n0(hrv3, l)} ms (βάση ${n0(hrvBase!, l)})` : ""}. ${good ? "Καλή μέρα για πιο απαιτητική προπόνηση." : "Μπορείς να προπονηθείς κανονικά."}`
        : `${rhr3 != null ? `Resting HR ${n0(rhr3, l)} bpm (baseline ${n0(rhrBase!, l)})` : ""}${rhr3 != null && hrv3 != null ? ", " : ""}${hrv3 != null ? `HRV ${n0(hrv3, l)} ms (baseline ${n0(hrvBase!, l)})` : ""}. ${good ? "A good day for a harder session." : "Train as normal."}`,
    });
  }

  // Activity: 7-day steps vs 8,000/day.
  const steps = dailySeries(userId, "steps", 8, now).filter((p) => p.date !== isoDate(now)); // today is still partial
  const steps7 = avg(steps.slice(-7));
  if (steps7 != null) {
    const low = steps7 < 6000;
    const good = steps7 >= 8000;
    out.push({
      topic: "activity", tone: low ? "warn" : good ? "good" : "neutral", weight: low ? 2 + (6000 - steps7) / 2000 : good ? 1 : 1.2,
      title: el ? "Κίνηση" : "Activity",
      text: el
        ? `Μέσος όρος ${n0(steps7, l)} βήματα/ημέρα την τελευταία εβδομάδα. ${good ? "Πάνω από τον στόχο των 8.000 — συνέχισε." : `Πρόσθεσε έναν περίπατο ${n0(Math.min(40, Math.ceil((8000 - steps7) / 100)), l)} λεπτών σήμερα για να φτάσεις τα 8.000.`}`
        : `Average ${n0(steps7, l)} steps/day over the last week. ${good ? "Above the 8,000 goal — keep it up." : `Add a ${n0(Math.min(40, Math.ceil((8000 - steps7) / 100)), l)}-minute walk today to reach 8,000.`}`,
    });
  }

  // Body: weight trend over 30 days.
  const weight = dailySeries(userId, "weight", 45, now);
  if (weight.length >= 3) {
    const first = weight[0];
    const last = weight[weight.length - 1];
    const days = (Date.parse(last.date) - Date.parse(first.date)) / DAY_MS;
    if (days >= 14) {
      const perWeek = ((last.value - first.value) / days) * 7;
      out.push({
        topic: "body", tone: Math.abs(perWeek) > 1 ? "warn" : "neutral", weight: Math.abs(perWeek) > 1 ? 2 : 0.5,
        title: el ? "Βάρος" : "Weight",
        text: el
          ? `${n1(last.value, l)} kg, ${perWeek >= 0 ? "+" : ""}${n1(perWeek, l)} kg/εβδομάδα τις τελευταίες ${n0(days, l)} μέρες.${Math.abs(perWeek) > 1 ? " Γρήγορη αλλαγή — συζήτησέ τη με τον coach σου." : ""}`
          : `${n1(last.value, l)} kg, ${perWeek >= 0 ? "+" : ""}${n1(perWeek, l)} kg/week over the last ${n0(days, l)} days.${Math.abs(perWeek) > 1 ? " A fast change — discuss it with your coach." : ""}`,
      });
    }
  }

  // Biological age: point to it when it has never been run or is stale.
  const bio = get<{ result: string; created_at: number }>(
    "SELECT result, created_at FROM bio_age_reports WHERE user_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1",
    userId,
  );
  if (!bio) {
    out.push({
      topic: "bioage", tone: "neutral", weight: 0.8,
      title: el ? "Βιολογική ηλικία" : "Biological age",
      text: el ? "Δεν την έχεις υπολογίσει ακόμα. Άνοιξε «Βιολογική ηλικία» για να δεις πού βρίσκεσαι ανά σύστημα." : "You haven't calculated it yet. Open Biological age to see where you stand per body system.",
    });
  } else {
    const r = JSON.parse(bio.result) as { overall_bio_age: number; headline: string };
    const stale = now - bio.created_at > 30 * DAY_MS;
    out.push({
      topic: "bioage", tone: "neutral", weight: stale ? 1 : 0.3,
      title: el ? "Βιολογική ηλικία" : "Biological age",
      text: `${n1(r.overall_bio_age, l)} — ${r.headline}${stale ? (el ? " Έχει περάσει πάνω από μήνας· κάνε νέο υπολογισμό." : " It's over a month old; recalculate.") : ""}`,
    });
  }

  if (!out.some((i) => i.topic !== "bioage")) {
    out.push({
      topic: "data", tone: "neutral", weight: 5,
      title: el ? "Χρειάζονται δεδομένα" : "Data needed",
      text: el
        ? "Σύνδεσε το ρολόι σου από Προφίλ → Συσκευές και φόρα το και το βράδυ. Σε 3–7 μέρες θα εμφανιστούν εδώ ύπνος, αποκατάσταση και κίνηση."
        : "Connect your watch under Profile → Devices and wear it at night too. Sleep, recovery and activity will show up here within 3–7 days.",
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** The Today card: the most notable observation, as two short sentences. */
export function dailyInsight(userId: string, now = Date.now()): string {
  return insights(userId, now)[0].text;
}
