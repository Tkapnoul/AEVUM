import { describe, expect, it } from "vitest";
import { findDate, parseLabText, parseLine } from "../shared/labText";
import { computeReport, fitnessAge, type EngineInput } from "../server/lib/bioengine";

// Typical Greek private-lab report text, as pdf.js or OCR returns it.
const GREEK_REPORT = `ΒΙΟΪΑΤΡΙΚΗ ΔΙΑΓΝΩΣΤΙΚΗ
Ημερομηνία: 03/09/2026  Ασθενής: ΠΑΠΑΔΟΠΟΥΛΟΣ Γ.
ΓΕΝΙΚΗ ΑΙΜΑΤΟΣ
Λευκά αιμοσφαίρια (WBC) 6,2 10^3/μL 4,0 - 10,5
Λεμφοκύτταρα % 31,4 % 20 - 45
Λεμφοκύτταρα # 1,9 10^3/μL 1,0 - 4,0
Αιμοσφαιρίνη (HGB) 15,1 g/dL 13,5 - 17,5
MCV 88,2 fL 80 - 99
RDW 12,6 % 11,5 - 14,5
Αιμοπετάλια (PLT) 245 10^3/μL 150 - 400
ΒΙΟΧΗΜΙΚΕΣ
Γλυκόζη 92 mg/dl 70 - 110
Γλυκοζυλιωμένη αιμοσφαιρίνη HbA1c 5,3 % 4,0 - 6,0
Κρεατινίνη 0,94 mg/dl 0,7 - 1,3
Ολική χοληστερόλη 196 mg/dl < 200
HDL χοληστερόλη 54 mg/dl > 40
LDL χοληστερόλη 118 mg/dl < 130
Τριγλυκερίδια 88 mg/dl 40 - 150
ΑLT (SGPT) 22 U/L 5 - 41
AST (SGOT) 19 U/L 5 - 40
γ-GT 18 U/L 8 - 61
Αλκαλική φωσφατάση 64 U/L 40 - 129
Λευκωματίνη 4,6 g/dl 3,5 - 5,2
CRP 0,8 mg/L < 5
Βιταμίνη B12 412 pg/ml 197 - 771
Βιταμίνη D (25-OH) 31 ng/ml 30 - 100
TSH 1,82 μIU/mL 0,4 - 4,0
Φερριτίνη 98 ng/ml 30 - 400
Παλαιότερη τιμή Γλυκόζη 101 mg/dl`;

describe("lab report text parser", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const r = parseLabText(GREEK_REPORT, now);
  const by = Object.fromEntries(r.results.map((x) => [x.markerKey, x]));

  it("finds the date", () => {
    expect(r.takenAt).toBe("2026-09-03");
    expect(findDate("Printed 2030-01-01, sample 12.08.2026", now)).toBe("2026-08-12");
  });

  it("reads values, units and ranges with Greek decimal commas", () => {
    expect(by.wbc).toMatchObject({ value: 6.2, unit: "10³/µL", refLow: 4, refHigh: 10.5 });
    expect(by.lymphocyte_pct).toMatchObject({ value: 31.4, unit: "%" });
    expect(by.glucose).toMatchObject({ value: 92, unit: "mg/dL", refLow: 70, refHigh: 110 });
    expect(by.hba1c).toMatchObject({ value: 5.3, unit: "%" });
    expect(by.creatinine).toMatchObject({ value: 0.94, unit: "mg/dL" });
    expect(by.total_cholesterol).toMatchObject({ value: 196, refLow: null, refHigh: 200 });
    expect(by.hdl).toMatchObject({ value: 54, refLow: 40, refHigh: null });
    expect(by.crp).toMatchObject({ value: 0.8, unit: "mg/L", refHigh: 5 });
    expect(by.b12).toMatchObject({ value: 412, unit: "pg/mL" });
    expect(by.vitamin_d).toMatchObject({ value: 31, unit: "ng/mL" });
    expect(by.tsh).toMatchObject({ value: 1.82 });
    expect(by.mcv).toMatchObject({ value: 88.2, unit: "fL" });
    expect(by.rdw).toMatchObject({ value: 12.6 });
    expect(by.alp).toMatchObject({ value: 64 });
    expect(by.albumin).toMatchObject({ value: 4.6, unit: "g/dL" });
    expect(by.platelets).toMatchObject({ value: 245 });
  });

  it("handles OCR's Greek look-alike capitals", () => {
    expect(by.alt).toMatchObject({ value: 22 });
    expect(parseLine("ΗDL 48 mg/dl")?.markerKey).toBe("hdl");
  });

  it("keeps the first occurrence and ignores absolute lymphocyte counts", () => {
    expect(by.glucose.value).toBe(92);
    expect(r.results.filter((x) => x.markerKey === "lymphocyte_pct")).toHaveLength(1);
  });

  it("survives typical OCR slips", () => {
    expect(parseLine("Λεμφοκύτταρα 96 31.4 % 20 - 45")).toMatchObject({ markerKey: "lymphocyte_pct", value: 31.4, refLow: 20, refHigh: 45 });
    expect(parseLine("Κρεατινίνη 0,94 mg/d| 0,7-1,3")).toMatchObject({ value: 0.94, unit: "mg/dL", refLow: 0.7, refHigh: 1.3 });
    expect(parseLine("Λεμφοκύτταρα # 1,9 10^3/μL")).toBeNull();
    expect(parseLine("Λεμφοκύτταρα % 314 % 20 - 45")?.value).toBe(31.4);
  });

  it("ignores lines that are not results", () => {
    expect(parseLine("ΓΕΝΙΚΗ ΑΙΜΑΤΟΣ")).toBeNull();
    expect(parseLine("Ασθενής: ΠΑΠΑΔΟΠΟΥΛΟΣ")).toBeNull();
  });
});

describe("rule-based biological age", () => {
  it("fitness age follows the FRIEND medians", () => {
    expect(fitnessAge(42.4, "male")).toBeCloseTo(35, 5);
    expect(fitnessAge(27.9, "female")).toBeCloseTo(45, 5);
    expect(fitnessAge(40.1, "male")).toBeCloseTo(40, 0);
    expect(fitnessAge(60, "male")).toBe(20); // clamped
    expect(fitnessAge(10, "female")).toBe(90);
  });

  const base: EngineInput = {
    locale: "el",
    age: 45,
    sex: "male",
    heightCm: 180,
    m: { vo2max: 42.4, resting_hr: 56, bp_systolic: 116, bp_diastolic: 74, steps: 10_500, weight: 77, body_fat: 16, sleep_minutes: 450, bedtime_sd: 30, hrv: 52, hrv_baseline: 50 },
    days: { vo2max: 10, steps: 30 },
    labs: { glucose: 86, hba1c: 5.2, triglycerides: 80, hdl: 58 },
    pheno: { value: 39, missing: [] },
    sleepNights: 28,
  };

  it("averages PhenoAge and fitness age into a high-confidence estimate", () => {
    const r = computeReport(base);
    expect(r.overall_bio_age).toBe(37); // (39 + 35) / 2
    expect(r.confidence).toBe("high");
    expect(r.systems).toHaveLength(7);
    expect(r.systems.find((s) => s.key === "cardiorespiratory")).toMatchObject({ bio_age: 35, status: "younger" });
    expect(r.systems.every((s) => s.status === "younger")).toBe(true);
    expect(r.headline).toContain("νεότερα");
    expect(r.data_gaps).toHaveLength(0);
  });

  it("flags weak systems, recommends for them and lists gaps", () => {
    const r = computeReport({
      ...base,
      locale: "en",
      m: { ...base.m, vo2max: 30, bp_systolic: 142, bp_diastolic: 91, steps: 3800, weight: 101, body_fat: 30 },
      labs: { glucose: 108 },
      pheno: { value: null, missing: ["crp", "rdw"] },
    });
    expect(r.confidence).toBe("medium");
    expect(r.overall_bio_age).toBeGreaterThan(55); // fitness age only
    const status = Object.fromEntries(r.systems.map((s) => [s.key, s.status]));
    expect(status).toMatchObject({ cardiorespiratory: "older", cardiovascular: "older", metabolic: "older", body_composition: "older", activity: "older" });
    expect(r.recommendations.length).toBeLessThanOrEqual(5);
    expect(r.recommendations.every((x) => x.priority === "high")).toBe(true);
    expect(r.data_gaps.map((g) => g.what)).toContain("Blood tests for PhenoAge");
  });

  it("without validated inputs reports chronological age with low confidence", () => {
    const r = computeReport({ ...base, sex: null, m: { steps: 7000 }, labs: {}, pheno: { value: null, missing: [] }, sleepNights: 0 });
    expect(r.overall_bio_age).toBe(45);
    expect(r.confidence).toBe("low");
    expect(r.systems.filter((s) => s.status === "unknown").length).toBe(6);
  });
});
