import { all, get } from "../db.js";
import { dailySeries, mean } from "./metrics-store.js";
import { latestLabs, phenoAgeFor, PHENOAGE_MARKERS } from "./phenoage.js";
import { labDef, type LabKey } from "../../shared/labs.js";
import type { MetricType } from "../../shared/metrics.js";
import type { BioAgeReport } from "../ai/bioage.js";

// Rule-based biological age: no AI, no API key. Only two inputs produce an *age*, because only they
// have published, validated age references:
//   - PhenoAge (Levine 2018) from nine blood markers;
//   - fitness age: the age at which the member's VO2max is the population median (FRIEND registry,
//     Kaminsky et al., Mayo Clin Proc 2015, treadmill tests, apparently healthy US adults).
// Every other system gets a status (younger / on track / older) against guideline thresholds
// (AHA blood pressure, ADA glucose/HbA1c, WHO activity, AASM sleep duration, BMI categories).

export const ENGINE_MODEL = "aevum-rules-1";

// FRIEND 2015 50th percentile VO2max (ml/kg/min) by decade, placed at the decade midpoint.
const FRIEND_MEDIAN = {
  male: [[25, 48.0], [35, 42.4], [45, 37.8], [55, 32.6], [65, 28.2], [75, 24.4]],
  female: [[25, 37.6], [35, 30.9], [45, 27.9], [55, 24.2], [65, 20.9], [75, 18.3]],
} as const;

/** Age at which `vo2` is the population median for the sex; linear between decades, extended at the ends. */
export function fitnessAge(vo2: number, sex: "male" | "female"): number {
  const pts = FRIEND_MEDIAN[sex];
  let i = pts.findIndex(([, v]) => vo2 >= v);
  if (i === 0) i = 1; // fitter than the 25-year-old median: extend the first segment
  if (i === -1) i = pts.length - 1; // below the 75-year-old median: extend the last segment
  const [a1, v1] = pts[i - 1];
  const [a2, v2] = pts[i];
  const age = a1 + ((v1 - vo2) / (v1 - v2)) * (a2 - a1);
  return Math.min(90, Math.max(20, age));
}

type Status = "younger" | "on_track" | "older" | "unknown";
type Level = "low" | "medium" | "high";
type System = BioAgeReport["systems"][number];
type Rec = BioAgeReport["recommendations"][number];

export interface EngineInput {
  locale: "el" | "en";
  age: number;
  sex: "male" | "female" | null;
  heightCm: number | null;
  /** 30-day means (14-day for HRV, latest for weight), null when there is no data. */
  m: Partial<Record<"vo2max" | "resting_hr" | "hrv" | "hrv_baseline" | "bp_systolic" | "bp_diastolic" | "steps" | "exercise_minutes" | "weight" | "body_fat" | "sleep_minutes" | "bedtime_sd", number | null>>;
  /** Days with data, per metric. */
  days: Partial<Record<string, number>>;
  labs: Partial<Record<LabKey, number>>; // canonical units
  pheno: { value: number | null; missing: LabKey[] };
  sleepNights: number;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (x: number, d = 0) => (d ? r1(x).toFixed(1) : Math.round(x).toLocaleString("el-GR"));

const T = {
  el: {
    headlineYounger: (d: number) => `Το σώμα σου συμπεριφέρεται περίπου ${fmt(d, 1)} χρόνια νεότερα από την ηλικία σου.`,
    headlineOlder: (d: number) => `Το σώμα σου συμπεριφέρεται περίπου ${fmt(d, 1)} χρόνια μεγαλύτερο από την ηλικία σου.`,
    headlineSame: "Η βιολογική σου ηλικία είναι περίπου ίδια με τη χρονολογική.",
    headlineNoData: "Δεν υπάρχουν ακόμη δεδομένα για αξιόπιστη βιολογική ηλικία — δες τι λείπει παρακάτω.",
    summary: (parts: string[], n: number, total: number) =>
      `${parts.join(" ")} Αξιολογήθηκαν ${n} από ${total} συστήματα· όσα δεν έχουν ηλικία δείχνουν μόνο αν είσαι εντός, πάνω ή κάτω από τα όρια των κατευθυντήριων οδηγιών. Ο υπολογισμός γίνεται με σταθερούς κανόνες, χωρίς AI.`,
    sumPheno: (p: number) => `Η PhenoAge από τις εξετάσεις αίματος (τύπος Levine 2018) είναι ${fmt(p, 1)}.`,
    sumFit: (f: number, v: number) => `Η ηλικία φυσικής κατάστασης από το VO₂max ${fmt(v, 1)} είναι ${fmt(f, 1)} (διάμεσος πληθυσμού, μητρώο FRIEND).`,
    sumBoth: "Η συνολική ηλικία είναι ο μέσος όρος των δύο.",
    sumNone: "Χωρίς VO₂max ή πλήρεις εξετάσεις αίματος δεν μπορεί να βγει αξιόπιστος αριθμός· η συνολική εμφανίζεται ίση με τη χρονολογική.",
    ev: {
      vo2: (v: number, f: number) => `VO₂max ${fmt(v, 1)} ml/kg/min — είναι η διάμεσος για ηλικία ${fmt(f, 1)}.`,
      cv: (parts: string[]) => parts.join(", ") + ".",
      bp: (s: number, d: number) => `πίεση ${fmt(s)}/${fmt(d)} mmHg`,
      rhr: (r: number) => `παλμοί ηρεμίας ${fmt(r)} bpm`,
      pheno: (p: number) => `PhenoAge ${fmt(p, 1)} από 9 δείκτες αίματος.`,
      crp: (c: number) => `CRP ${fmt(c, 1)} mg/L (χωρίς πλήρες πάνελ για PhenoAge).`,
      steps: (s: number, ex: number | null) => `${fmt(s)} βήματα/ημέρα${ex != null ? `, ${fmt(ex * 7)} λεπτά άσκησης/εβδομάδα` : ""} (μ.ό. 30 ημερών).`,
      bmi: (b: number, bf: number | null) => `ΔΜΣ ${fmt(b, 1)}${bf != null ? `, λίπος ${fmt(bf, 1)}%` : ""}.`,
      sleep: (h: number, sd: number | null, hrv: string | null) => `Ύπνος ${fmt(h, 1)} ώρες/νύχτα${sd != null ? `, διακύμανση ώρας ύπνου ±${fmt(sd)} λεπτά` : ""}${hrv ? `, ${hrv}` : ""}.`,
      hrvTrend: (pct: number) => `HRV ${pct >= 0 ? "+" : ""}${fmt(pct)}% έναντι της βάσης σου`,
      metab: (parts: string[]) => parts.join(", ") + ".",
    },
    km: { vo2: "VO₂max", fit: "Ηλικία φυσικής κατάστασης", bp: "Πίεση", rhr: "Παλμοί ηρεμίας", pheno: "PhenoAge", crp: "CRP", steps: "Βήματα/ημέρα", ex: "Άσκηση/εβδομάδα", bmi: "ΔΜΣ", bf: "Λίπος", sleep: "Ύπνος", sd: "Σταθερότητα ώρας ύπνου", hrv: "HRV έναντι βάσης" },
    sys: {
      cardiorespiratory: "Καρδιοαναπνευστική ικανότητα",
      cardiovascular: "Καρδιαγγειακό",
      metabolic: "Μεταβολισμός",
      body_composition: "Σύσταση σώματος",
      sleep_recovery: "Ύπνος & αποκατάσταση",
      inflammation_blood: "Αίμα & φλεγμονή",
      activity: "Δραστηριότητα",
    },
    rec: {
      vo2: { title: "Ανέβασε το VO₂max", detail: "2 φορές/εβδομάδα διαλειμματική 4×4 (4 λεπτά στο ~90% των μέγιστων παλμών, 3 λεπτά ήπια) και 2–3 ώρες/εβδομάδα χαλαρή αερόβια (ζώνη 2).", effect: "Συνήθως +3–5 ml/kg/min σε 8–12 εβδομάδες, δηλαδή αρκετά χρόνια νεότερη ηλικία φυσικής κατάστασης." },
      bp: { title: "Χαμήλωσε την πίεση", detail: "Μέτρα πίεση 2 φορές/ημέρα για 1 εβδομάδα και δείξε τις τιμές στον γιατρό σου. Αλάτι κάτω από 5 g/ημέρα, 150+ λεπτά αερόβια/εβδομάδα, λιγότερο αλκοόλ.", effect: "Η άσκηση και η μείωση αλατιού ρίχνουν συνήθως 4–8 mmHg τη συστολική." },
      rhr: { title: "Ρίξε τους παλμούς ηρεμίας", detail: "Αερόβια άσκηση 150–300 λεπτά/εβδομάδα, ύπνος 7+ ωρών, λιγότερο αλκοόλ και καφεΐνη αργά το απόγευμα.", effect: "Πτώση 5–10 bpm μέσα σε 2–3 μήνες είναι συνηθισμένη." },
      steps: (target: number) => ({ title: "Περισσότερα βήματα", detail: `Στόχος ${fmt(target)} βήματα/ημέρα: 2 περίπατοι 15 λεπτών (μετά το φαγητό) και σκάλες αντί για ασανσέρ.`, effect: "Ο κίνδυνος θνησιμότητας πέφτει σταθερά μέχρι τα 8.000–10.000 βήματα (6.000–8.000 μετά τα 60)." }),
      sleep: { title: "Σταθερός ύπνος 7–9 ωρών", detail: "Ίδια ώρα ύπνου και ξυπνήματος κάθε μέρα (±30 λεπτά, και Σαββατοκύριακο), οθόνες κλειστές 1 ώρα πριν, δροσερό σκοτεινό δωμάτιο.", effect: "Καλύτερη αποκατάσταση και HRV μέσα σε 2–4 εβδομάδες." },
      weight: { title: "Μείωσε το σωματικό λίπος", detail: "Έλλειμμα ~300–500 kcal/ημέρα, πρωτεΐνη 1,6 g/kg, βάρη 2–3 φορές/εβδομάδα για να κρατήσεις μυϊκή μάζα.", effect: "Απώλεια ~0,5% του βάρους/εβδομάδα χωρίς απώλεια μυών." },
      metab: { title: "Βελτίωσε τον μεταβολισμό", detail: "Λιγότερα επεξεργασμένα σάκχαρα και αλκοόλ, φυτικές ίνες 30 g/ημέρα, περπάτημα 10–15 λεπτά μετά από κάθε γεύμα. Επανέλεγχος σε 3 μήνες με τον γιατρό σου.", effect: "Πτώση γλυκόζης νηστείας και τριγλυκεριδίων σε 8–12 εβδομάδες." },
      inflam: { title: "Δούλεψε τους δείκτες αίματος", detail: "Συζήτησε τις εκτός ορίων τιμές με τον γιατρό σου. Μεσογειακή διατροφή, άσκηση, ύπνος και όχι κάπνισμα ρίχνουν τη φλεγμονή (CRP).", effect: "Η PhenoAge αλλάζει μέσα σε μήνες όταν βελτιώνονται γλυκόζη, CRP και RDW." },
    },
    gaps: {
      vo2: { what: "VO₂max", why: "Ο ισχυρότερος δείκτης φυσικής κατάστασης· δίνει «ηλικία φυσικής κατάστασης». Τα περισσότερα ρολόγια το υπολογίζουν μετά από 10–15 λεπτά γρήγορο περπάτημα ή τρέξιμο έξω με GPS." },
      pheno: (names: string) => ({ what: "Εξετάσεις αίματος για PhenoAge", why: `Λείπουν: ${names}. Με όλους τους 9 δείκτες (από την ίδια αιμοληψία) υπολογίζεται η επικυρωμένη PhenoAge.` }),
      bp: { what: "Πίεση", why: "Για το καρδιαγγειακό. Πέρασε μετρήσεις στα Δεδομένα ή από πιεσόμετρο που γράφει στο Health Connect/Apple Health." },
      body: { what: "Βάρος και ύψος", why: "Για τον ΔΜΣ. Συμπλήρωσε ύψος στο προφίλ και βάρος στα Δεδομένα." },
      sleep: { what: "Δεδομένα ύπνου", why: "Φόρα το ρολόι το βράδυ για τουλάχιστον 14 νύχτες." },
      sex: { what: "Φύλο", why: "Οι πίνακες VO₂max διαφέρουν για άνδρες και γυναίκες. Συμπλήρωσέ το στο προφίλ." },
      metab: { what: "Γλυκόζη, HbA1c, λιπίδια", why: "Για τον μεταβολισμό. Πρόσθεσε τις εξετάσεις σου." },
    },
  },
  en: {
    headlineYounger: (d: number) => `Your body behaves about ${fmt(d, 1)} years younger than your age.`,
    headlineOlder: (d: number) => `Your body behaves about ${fmt(d, 1)} years older than your age.`,
    headlineSame: "Your biological age is about the same as your chronological age.",
    headlineNoData: "Not enough data yet for a reliable biological age — see what's missing below.",
    summary: (parts: string[], n: number, total: number) =>
      `${parts.join(" ")} ${n} of ${total} systems were assessed; those without an age only show whether you are inside, above or below guideline thresholds. Computed with fixed rules, no AI.`,
    sumPheno: (p: number) => `PhenoAge from your blood tests (Levine 2018 formula) is ${fmt(p, 1)}.`,
    sumFit: (f: number, v: number) => `Fitness age from VO₂max ${fmt(v, 1)} is ${fmt(f, 1)} (population median, FRIEND registry).`,
    sumBoth: "The overall age is the average of the two.",
    sumNone: "Without VO₂max or a full blood panel there is no reliable number; the overall is shown equal to your chronological age.",
    ev: {
      vo2: (v: number, f: number) => `VO₂max ${fmt(v, 1)} ml/kg/min — the median for age ${fmt(f, 1)}.`,
      cv: (parts: string[]) => parts.join(", ") + ".",
      bp: (s: number, d: number) => `blood pressure ${fmt(s)}/${fmt(d)} mmHg`,
      rhr: (r: number) => `resting heart rate ${fmt(r)} bpm`,
      pheno: (p: number) => `PhenoAge ${fmt(p, 1)} from 9 blood markers.`,
      crp: (c: number) => `CRP ${fmt(c, 1)} mg/L (no full panel for PhenoAge).`,
      steps: (s: number, ex: number | null) => `${fmt(s)} steps/day${ex != null ? `, ${fmt(ex * 7)} exercise min/week` : ""} (30-day mean).`,
      bmi: (b: number, bf: number | null) => `BMI ${fmt(b, 1)}${bf != null ? `, body fat ${fmt(bf, 1)}%` : ""}.`,
      sleep: (h: number, sd: number | null, hrv: string | null) => `Sleep ${fmt(h, 1)} h/night${sd != null ? `, bedtime varies ±${fmt(sd)} min` : ""}${hrv ? `, ${hrv}` : ""}.`,
      hrvTrend: (pct: number) => `HRV ${pct >= 0 ? "+" : ""}${fmt(pct)}% vs your baseline`,
      metab: (parts: string[]) => parts.join(", ") + ".",
    },
    km: { vo2: "VO₂max", fit: "Fitness age", bp: "Blood pressure", rhr: "Resting HR", pheno: "PhenoAge", crp: "CRP", steps: "Steps/day", ex: "Exercise/week", bmi: "BMI", bf: "Body fat", sleep: "Sleep", sd: "Bedtime consistency", hrv: "HRV vs baseline" },
    sys: {
      cardiorespiratory: "Cardiorespiratory fitness",
      cardiovascular: "Cardiovascular",
      metabolic: "Metabolic",
      body_composition: "Body composition",
      sleep_recovery: "Sleep & recovery",
      inflammation_blood: "Blood & inflammation",
      activity: "Activity",
    },
    rec: {
      vo2: { title: "Raise your VO₂max", detail: "Twice a week 4×4 intervals (4 min at ~90% of max heart rate, 3 min easy) plus 2–3 h/week of easy zone-2 cardio.", effect: "Typically +3–5 ml/kg/min in 8–12 weeks, several years off your fitness age." },
      bp: { title: "Lower your blood pressure", detail: "Measure twice daily for a week and show the readings to your doctor. Salt under 5 g/day, 150+ min/week of cardio, less alcohol.", effect: "Exercise and less salt usually lower systolic pressure by 4–8 mmHg." },
      rhr: { title: "Lower your resting heart rate", detail: "Cardio 150–300 min/week, 7+ hours of sleep, less alcohol and late caffeine.", effect: "A 5–10 bpm drop within 2–3 months is common." },
      steps: (target: number) => ({ title: "Walk more", detail: `Aim for ${Math.round(target).toLocaleString("en-US")} steps/day: two 15-minute walks (after meals) and the stairs instead of the lift.`, effect: "Mortality risk keeps falling up to 8,000–10,000 steps (6,000–8,000 over 60)." }),
      sleep: { title: "Consistent 7–9 h sleep", detail: "Same bed and wake time every day (±30 min, weekends too), screens off 1 h before, cool dark room.", effect: "Better recovery and HRV within 2–4 weeks." },
      weight: { title: "Reduce body fat", detail: "A ~300–500 kcal/day deficit, protein 1.6 g/kg, strength training 2–3×/week to keep muscle.", effect: "About 0.5% of body weight per week without losing muscle." },
      metab: { title: "Improve your metabolic markers", detail: "Fewer processed sugars and less alcohol, fibre 30 g/day, a 10–15 minute walk after each meal. Re-test in 3 months with your doctor.", effect: "Lower fasting glucose and triglycerides in 8–12 weeks." },
      inflam: { title: "Work on your blood markers", detail: "Discuss out-of-range values with your doctor. Mediterranean diet, exercise, sleep and not smoking lower inflammation (CRP).", effect: "PhenoAge moves within months as glucose, CRP and RDW improve." },
    },
    gaps: {
      vo2: { what: "VO₂max", why: "The strongest fitness marker, and the basis for fitness age. Most watches estimate it after a 10–15 minute brisk outdoor walk or run with GPS." },
      pheno: (names: string) => ({ what: "Blood tests for PhenoAge", why: `Missing: ${names}. With all 9 markers (from the same draw) the validated PhenoAge is computed.` }),
      bp: { what: "Blood pressure", why: "For the cardiovascular system. Enter readings under Data or use a cuff that writes to Health Connect/Apple Health." },
      body: { what: "Weight and height", why: "For BMI. Add height in your profile and weight under Data." },
      sleep: { what: "Sleep data", why: "Wear your watch at night for at least 14 nights." },
      sex: { what: "Sex", why: "VO₂max norms differ for men and women. Set it in your profile." },
      metab: { what: "Glucose, HbA1c, lipids", why: "For the metabolic system. Add your blood tests." },
    },
  },
};

const statusVsAge = (bio: number, age: number): Status => (bio <= age - 2 ? "younger" : bio >= age + 2 ? "older" : "on_track");

/** Pure function: same input → same report. */
export function computeReport(x: EngineInput): BioAgeReport {
  const L = T[x.locale];
  const { m, labs, age } = x;
  const systems: System[] = [];
  const recs: (Rec & { order: number })[] = [];
  const gaps: BioAgeReport["data_gaps"] = [];
  const younger: string[] = [];
  const older: string[] = [];
  const sys = (s: System) => {
    systems.push(s);
    if (s.status === "younger") younger.push(`${L.sys[s.key]}: ${s.evidence}`);
    if (s.status === "older") older.push(`${L.sys[s.key]}: ${s.evidence}`);
  };
  const unknown = (key: System["key"]): System => ({ key, bio_age: null, confidence: "low", status: "unknown", evidence: "—", key_metrics: [] });
  const rec = (r: { title: string; detail: string; effect: string }, priority: Rec["priority"], order: number) =>
    recs.push({ title: r.title, detail: r.detail, expected_effect: r.effect, priority, order });

  // Cardiorespiratory: fitness age from VO2max.
  let fit: number | null = null;
  if (m.vo2max != null && x.sex) {
    fit = r1(fitnessAge(m.vo2max, x.sex));
    const st = statusVsAge(fit, age);
    sys({
      key: "cardiorespiratory", bio_age: fit, confidence: (x.days.vo2max ?? 0) >= 3 ? "medium" : "low", status: st,
      evidence: L.ev.vo2(m.vo2max, fit),
      key_metrics: [{ label: L.km.vo2, value: `${fmt(m.vo2max, 1)} ml/kg/min` }, { label: L.km.fit, value: fmt(fit, 1) }],
    });
    if (st !== "younger") rec(L.rec.vo2, st === "older" ? "high" : "medium", 1);
  } else {
    sys(unknown("cardiorespiratory"));
    gaps.push(m.vo2max != null ? L.gaps.sex : L.gaps.vo2);
  }

  // Cardiovascular: AHA 2017 blood-pressure categories plus resting heart rate.
  {
    const parts: string[] = [];
    const km: System["key_metrics"] = [];
    let flags = 0;
    let good = 0;
    let n = 0;
    if (m.bp_systolic != null && m.bp_diastolic != null) {
      n++;
      parts.push(L.ev.bp(m.bp_systolic, m.bp_diastolic));
      km.push({ label: L.km.bp, value: `${fmt(m.bp_systolic)}/${fmt(m.bp_diastolic)} mmHg` });
      if (m.bp_systolic >= 130 || m.bp_diastolic >= 80) {
        flags++;
        rec(L.rec.bp, m.bp_systolic >= 140 || m.bp_diastolic >= 90 ? "high" : "medium", 2);
      } else if (m.bp_systolic < 120) good++;
    } else gaps.push(L.gaps.bp);
    if (m.resting_hr != null) {
      n++;
      parts.push(L.ev.rhr(m.resting_hr));
      km.push({ label: L.km.rhr, value: `${fmt(m.resting_hr)} bpm` });
      if (m.resting_hr > 75) {
        flags++;
        rec(L.rec.rhr, m.resting_hr > 85 ? "high" : "medium", 4);
      } else if (m.resting_hr <= 60) good++;
    }
    if (!n) sys(unknown("cardiovascular"));
    else
      sys({
        key: "cardiovascular", bio_age: null, confidence: n === 2 ? "medium" : "low",
        status: flags ? "older" : good === n ? "younger" : "on_track",
        evidence: L.ev.cv(parts), key_metrics: km,
      });
  }

  // Metabolic: ADA glucose/HbA1c, lipid thresholds.
  {
    const parts: string[] = [];
    const km: System["key_metrics"] = [];
    let flags = 0;
    let n = 0;
    const lab = (k: LabKey, bad: (v: number) => boolean, d = 0) => {
      const v = labs[k];
      if (v == null) return null;
      n++;
      const def = labDef(k)!;
      const name = def.name[x.locale].replace(/\s*\(.*\)$/, "");
      parts.push(`${name} ${fmt(v, d)} ${def.unit}`);
      km.push({ label: name, value: `${fmt(v, d)} ${def.unit}` });
      if (bad(v)) flags++;
      return v;
    };
    const glu = lab("glucose", (v) => v >= 100);
    const a1c = lab("hba1c", (v) => v >= 5.7, 1);
    const tg = lab("triglycerides", (v) => v >= 150);
    lab("hdl", (v) => v < (x.sex === "female" ? 50 : 40));
    lab("ldl", (v) => v >= 160);
    lab("apob", (v) => v >= 130);
    if (!n) {
      sys(unknown("metabolic"));
      gaps.push(L.gaps.metab);
    } else {
      const glycaemia = (glu != null && glu >= 100) || (a1c != null && a1c >= 5.7);
      const optimal = !flags && (glu == null || glu < 90) && (a1c == null || a1c < 5.4) && (tg == null || tg < 100);
      const st: Status = glycaemia || flags >= 2 ? "older" : optimal && n >= 2 ? "younger" : "on_track";
      sys({ key: "metabolic", bio_age: null, confidence: n >= 3 ? "medium" : "low", status: st, evidence: L.ev.metab(parts), key_metrics: km });
      if (flags) rec(L.rec.metab, glycaemia ? "high" : "medium", 3);
    }
  }

  // Body composition: BMI categories, body fat when available.
  if (m.weight != null && x.heightCm) {
    const bmi = m.weight / (x.heightCm / 100) ** 2;
    const bf = m.body_fat ?? null;
    const lean = bf != null && (x.sex === "female" ? bf < 28 : bf < 20);
    const highFat = bf != null && (x.sex === "female" ? bf >= 35 : bf >= 25);
    // BMI can't tell muscle from fat, so the overweight band only counts against the member when body fat
    // confirms it or BMI is clearly high.
    const st: Status =
      bmi < 18.5 || bmi >= 30 ? "older"
        : bmi >= 25 ? (highFat || (bf == null && bmi >= 27.5) ? "older" : "on_track")
          : lean ? "younger" : "on_track";
    sys({
      key: "body_composition", bio_age: null, confidence: bf != null ? "medium" : "low", status: st,
      evidence: L.ev.bmi(bmi, bf),
      key_metrics: [{ label: L.km.bmi, value: fmt(bmi, 1) }, ...(bf != null ? [{ label: L.km.bf, value: `${fmt(bf, 1)}%` }] : [])],
    });
    if (st === "older" && bmi >= 25) rec(L.rec.weight, bmi >= 30 ? "high" : "medium", 5);
  } else {
    sys(unknown("body_composition"));
    gaps.push(L.gaps.body);
  }

  // Sleep & recovery: duration (AASM 7–9 h), regularity, HRV vs own baseline.
  if (m.sleep_minutes != null && x.sleepNights >= 5) {
    const h = m.sleep_minutes / 60;
    const sd = m.bedtime_sd ?? null;
    const hrvPct = m.hrv != null && m.hrv_baseline ? ((m.hrv - m.hrv_baseline) / m.hrv_baseline) * 100 : null;
    const st: Status =
      h < 6 || (sd != null && sd > 90) || (hrvPct != null && hrvPct < -15) ? "older"
        : h >= 7 && h <= 9 && (sd == null || sd <= 45) && (hrvPct == null || hrvPct > -5) ? "younger"
          : "on_track";
    sys({
      key: "sleep_recovery", bio_age: null, confidence: x.sleepNights >= 14 ? "medium" : "low", status: st,
      evidence: L.ev.sleep(h, sd, hrvPct != null ? L.ev.hrvTrend(hrvPct) : null),
      key_metrics: [
        { label: L.km.sleep, value: `${fmt(h, 1)} h` },
        ...(sd != null ? [{ label: L.km.sd, value: `±${fmt(sd)} min` }] : []),
        ...(hrvPct != null ? [{ label: L.km.hrv, value: `${hrvPct >= 0 ? "+" : ""}${fmt(hrvPct)}%` }] : []),
      ],
    });
    if (st !== "younger") rec(L.rec.sleep, st === "older" ? "high" : "low", 6);
  } else {
    sys(unknown("sleep_recovery"));
    gaps.push(L.gaps.sleep);
  }

  // Blood & inflammation: PhenoAge, else CRP alone.
  const pheno = x.pheno.value != null ? r1(x.pheno.value) : null;
  if (pheno != null) {
    const st = statusVsAge(pheno, age);
    sys({ key: "inflammation_blood", bio_age: pheno, confidence: "high", status: st, evidence: L.ev.pheno(pheno), key_metrics: [{ label: L.km.pheno, value: fmt(pheno, 1) }] });
    if (st === "older") rec(L.rec.inflam, "high", 0);
  } else {
    if (labs.crp != null) {
      const crp = labs.crp;
      const st: Status = crp < 1 ? "younger" : crp > 3 ? "older" : "on_track";
      sys({ key: "inflammation_blood", bio_age: null, confidence: "low", status: st, evidence: L.ev.crp(crp), key_metrics: [{ label: L.km.crp, value: `${fmt(crp, 1)} mg/L` }] });
      if (st === "older") rec(L.rec.inflam, "medium", 0);
    } else sys(unknown("inflammation_blood"));
    const missing = x.pheno.missing.length ? x.pheno.missing : PHENOAGE_MARKERS;
    gaps.push(L.gaps.pheno(missing.map((k) => labDef(k)!.name[x.locale]).join(", ")));
  }

  // Activity: steps (Paluch 2022 dose-response) and WHO 150–300 min/week.
  if (m.steps != null) {
    const target = age >= 60 ? 7000 : 9000;
    const weekly = m.exercise_minutes != null ? m.exercise_minutes * 7 : null;
    const st: Status =
      m.steps >= target || (weekly != null && weekly >= 300) ? "younger"
        : m.steps < 5000 && (weekly == null || weekly < 75) ? "older"
          : "on_track";
    sys({
      key: "activity", bio_age: null, confidence: (x.days.steps ?? 0) >= 14 ? "medium" : "low", status: st,
      evidence: L.ev.steps(m.steps, m.exercise_minutes ?? null),
      key_metrics: [{ label: L.km.steps, value: fmt(m.steps) }, ...(weekly != null ? [{ label: L.km.ex, value: `${fmt(weekly)} min` }] : [])],
    });
    if (st !== "younger") rec(L.rec.steps(target), st === "older" ? "high" : "medium", 7);
  } else sys(unknown("activity"));

  // Overall: average of the validated ages only.
  const ages = [pheno, fit].filter((v): v is number => v != null);
  const overall = ages.length ? r1(ages.reduce((a, b) => a + b, 0) / ages.length) : r1(age);
  const confidence: Level = ages.length === 2 ? "high" : ages.length === 1 ? "medium" : "low";
  const diff = overall - age;
  const headline = !ages.length ? L.headlineNoData : diff <= -1 ? L.headlineYounger(-diff) : diff >= 1 ? L.headlineOlder(diff) : L.headlineSame;
  const sumParts = [
    ...(pheno != null ? [L.sumPheno(pheno)] : []),
    ...(fit != null ? [L.sumFit(fit, m.vo2max!)] : []),
    ...(ages.length === 2 ? [L.sumBoth] : ages.length ? [] : [L.sumNone]),
  ];
  const assessed = systems.filter((s) => s.status !== "unknown").length;

  const prio = { high: 0, medium: 1, low: 2 } as const;
  const recommendations = recs
    .sort((a, b) => prio[a.priority] - prio[b.priority] || a.order - b.order)
    .slice(0, 5)
    .map(({ title, detail, expected_effect, priority }) => ({ title, detail, expected_effect, priority }));

  return {
    overall_bio_age: overall,
    confidence,
    headline,
    summary: L.summary(sumParts, assessed, systems.length),
    systems,
    drivers_younger: younger,
    drivers_older: older,
    recommendations,
    data_gaps: gaps,
  };
}

/** Collects the engine input for a member from the database; null without a birth date. */
export function engineInput(userId: string, now = Date.now()): EngineInput | null {
  const u = get<{ birth_date: string | null; sex: string | null; height_cm: number | null; locale: string }>(
    "SELECT birth_date, sex, height_cm, locale FROM users WHERE id = ?",
    userId,
  );
  if (!u?.birth_date) return null;
  const age = (now - Date.parse(u.birth_date)) / (365.2425 * 86_400_000);
  const m: EngineInput["m"] = {};
  const days: EngineInput["days"] = {};
  const avg = (type: MetricType, n: number, key: keyof EngineInput["m"] = type as keyof EngineInput["m"]) => {
    const pts = dailySeries(userId, type, n, now);
    m[key] = mean(pts.map((p) => p.value));
    days[key] = pts.length;
  };
  for (const t of ["resting_hr", "bp_systolic", "bp_diastolic", "steps", "exercise_minutes", "body_fat", "sleep_minutes"] as const) avg(t, 30);
  // VO2max and weight change slowly and are measured rarely.
  avg("vo2max", 30);
  if (m.vo2max == null) avg("vo2max", 90);
  m.weight = dailySeries(userId, "weight", 90, now).at(-1)?.value ?? null;
  avg("hrv", 14);
  avg("hrv", 90, "hrv_baseline");

  const nights = all<{ start_ts: number | null }>(
    "SELECT MIN(start_ts) AS start_ts FROM sleep_sessions WHERE user_id = ? AND date >= ? GROUP BY date",
    userId, new Date(now - 30 * 86_400_000).toISOString().slice(0, 10),
  );
  const starts = nights.filter((s) => s.start_ts).map((s) => (((s.start_ts! / 60_000) % 1440) + 1440 + 720) % 1440); // minutes from noon
  const mu = mean(starts);
  m.bedtime_sd = mu != null && starts.length >= 5 ? Math.sqrt(starts.reduce((a, x) => a + (x - mu) ** 2, 0) / (starts.length - 1)) : null;

  const labs: EngineInput["labs"] = {};
  const cutoff = now - 2 * 365 * 86_400_000; // results older than two years don't describe the present
  for (const [k, l] of latestLabs(userId)) if (l.taken_at >= cutoff) labs[k] = l.value;
  const pheno = phenoAgeFor(userId, age);

  return {
    locale: u.locale === "en" ? "en" : "el",
    age,
    sex: u.sex === "male" || u.sex === "female" ? u.sex : null,
    heightCm: u.height_cm,
    m,
    days,
    labs,
    pheno: { value: pheno.value, missing: pheno.missing },
    sleepNights: nights.length,
  };
}
