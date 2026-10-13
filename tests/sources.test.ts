import { describe, expect, it } from "vitest";
import { haeToBatch, parseHaeDate } from "../server/lib/hae";
import { HealthBatch } from "../server/lib/ingest";
import { AppleExportParser, parseAppleDate } from "../src/lib/appleExport";
import { sleepNights } from "../src/lib/sleepNights";
import { phenoAge } from "../server/lib/phenoage";
import { matchLabKey, toCanonical } from "../shared/labs";

describe("Health Auto Export payload", () => {
  const payload = {
    data: {
      metrics: [
        { name: "step_count", units: "count", data: [{ date: "2026-10-12 00:00:00 +0300", qty: 9123, source: "Apple Watch" }] },
        { name: "walking_running_distance", units: "km", data: [{ date: "2026-10-12 00:00:00 +0300", qty: 6.4 }] },
        { name: "active_energy", units: "kJ", data: [{ date: "2026-10-12 00:00:00 +0300", qty: 2092 }] },
        { name: "heart_rate", units: "count/min", data: [{ date: "2026-10-12 08:00:00 +0300", Min: 55, Avg: 68, Max: 120 }] },
        { name: "heart_rate_variability", units: "ms", data: [{ date: "2026-10-12 03:12:00 +0300", qty: 48 }] },
        { name: "blood_oxygen_saturation", units: "%", data: [{ date: "2026-10-12 03:00:00 +0300", qty: 0.97 }] },
        { name: "blood_pressure", units: "mmHg", data: [{ date: "2026-10-12 09:00:00 +0300", systolic: 121, diastolic: 79 }] },
        {
          name: "sleep_analysis",
          units: "hr",
          data: [
            {
              date: "2026-10-12 00:00:00 +0300", sleepStart: "2026-10-11 23:20:00 +0300", sleepEnd: "2026-10-12 07:05:00 +0300",
              inBedStart: "2026-10-11 23:00:00 +0300", inBedEnd: "2026-10-12 07:15:00 +0300", core: 4.2, deep: 1.1, rem: 1.6, awake: 0.4, inBed: 8.25,
            },
          ],
        },
        { name: "toothbrushing", units: "count", data: [{ date: "2026-10-12 08:00:00 +0300", qty: 1 }] },
      ],
    },
  };

  it("parses dates with offsets", () => {
    expect(new Date(parseHaeDate("2026-10-12 08:00:00 +0300")!).toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("maps metrics, units and sleep into a valid batch", () => {
    const b = HealthBatch.parse(haeToBatch(payload));
    const get = (t: string) => b.metrics.find((m) => m.type === t)!;
    expect(get("steps")).toMatchObject({ value: 9123, ts: Date.parse("2026-10-12T00:00:00Z") });
    expect(get("distance").value).toBe(6400);
    expect(get("active_calories").value).toBeCloseTo(500, 0);
    expect(get("heart_rate").value).toBe(68);
    expect(get("spo2").value).toBe(97);
    expect(get("bp_systolic").value).toBe(121);
    expect(get("bp_diastolic").value).toBe(79);
    expect(b.metrics.some((m) => (m.type as string) === "toothbrushing")).toBe(false);
    expect(b.sleep[0]).toMatchObject({ date: "2026-10-12", totalMin: 414, deepMin: 66, remMin: 96, lightMin: 252, awakeMin: 24 });
  });
});

describe("Apple Health export parser", () => {
  const rec = (type: string, value: string | number, start: string, extra = "") =>
    `<Record type="${type}" sourceName="SRC" unit="${extra}" creationDate="${start}" startDate="${start}" endDate="${start}" value="${value}"/>\n`;
  const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const xml =
    `<?xml version="1.0"?>\n<HealthData locale="el_GR">\n` +
    rec("HKQuantityTypeIdentifierStepCount", 4000, `${day} 09:00:00 +0300`, "count") +
    rec("HKQuantityTypeIdentifierStepCount", 3000, `${day} 18:00:00 +0300`, "count") +
    // a second source counting the same steps must not be added on top
    rec("HKQuantityTypeIdentifierStepCount", 6800, `${day} 18:00:00 +0300`, "count").replace('sourceName="SRC"', 'sourceName="iPhone"') +
    rec("HKQuantityTypeIdentifierHeartRate", 60, `${day} 09:10:00 +0300`, "count/min") +
    rec("HKQuantityTypeIdentifierHeartRate", 70, `${day} 09:40:00 +0300`, "count/min") +
    rec("HKQuantityTypeIdentifierOxygenSaturation", 0.96, `${day} 03:00:00 +0300`, "%") +
    rec("HKQuantityTypeIdentifierBodyMass", 180, `${day} 07:00:00 +0300`, "lb") +
    rec("HKQuantityTypeIdentifierStepCount", 99999, `2001-01-01 09:00:00 +0300`, "count") +
    `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="${day} 00:00:00 +0300" endDate="${day} 03:00:00 +0300" value="HKCategoryValueSleepAnalysisAsleepCore">\n<MetadataEntry key="x" value="y"/>\n</Record>\n` +
    `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="${day} 03:00:00 +0300" endDate="${day} 04:30:00 +0300" value="HKCategoryValueSleepAnalysisAsleepDeep"/>\n` +
    `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="${day} 04:30:00 +0300" endDate="${day} 06:30:00 +0300" value="HKCategoryValueSleepAnalysisAsleepREM"/>\n` +
    `</HealthData>`;

  it("aggregates records even when split across arbitrary chunks", () => {
    const p = new AppleExportParser();
    const bytes = new TextEncoder().encode(xml);
    for (let i = 0; i < bytes.length; i += 37) p.push(bytes.slice(i, i + 37));
    p.push(new Uint8Array(), true);
    const { metrics, sleep } = p.result();
    const steps = metrics.filter((m) => m.type === "steps");
    expect(steps).toEqual([{ type: "steps", ts: Date.parse(`${day}T00:00:00Z`), value: 7000 }]);
    expect(metrics.find((m) => m.type === "heart_rate")).toMatchObject({ value: 65, ts: Date.parse(`${day}T09:30:00+03:00`) });
    expect(metrics.find((m) => m.type === "spo2")!.value).toBe(96);
    expect(metrics.find((m) => m.type === "weight")!.value).toBeCloseTo(81.6, 1);
    expect(sleep).toHaveLength(1);
    expect(sleep[0]).toMatchObject({ totalMin: 390, deepMin: 90, remMin: 120, lightMin: 180 });
  });

  it("parses Apple date strings", () => {
    expect(new Date(parseAppleDate("2026-01-15 07:32:10 +0200")).toISOString()).toBe("2026-01-15T05:32:10.000Z");
  });
});

describe("sleep nights", () => {
  it("prefers the staged watch night over the phone's in-bed estimate", () => {
    const h = 3600_000;
    const t0 = Date.parse("2026-10-11T21:00:00Z");
    const nights = sleepNights([
      { start: t0, end: t0 + 8 * h, state: "asleep", source: "iphone" },
      { start: t0 + h, end: t0 + 4 * h, state: "light", source: "watch" },
      { start: t0 + 4 * h, end: t0 + 5 * h, state: "deep", source: "watch" },
      { start: t0 + 5 * h, end: t0 + 7 * h, state: "rem", source: "watch" },
      { start: t0 + 12 * h, end: t0 + 12.5 * h, state: "asleep", source: "watch" }, // nap, ignored
    ]);
    expect(nights).toHaveLength(1);
    expect(nights[0]).toMatchObject({ totalMin: 360, deepMin: 60, remMin: 120, lightMin: 180 });
  });
});

describe("PhenoAge and lab catalogue", () => {
  const base = { albumin: 4.5, creatinine: 0.9, glucose: 90, crp: 1, lymphocyte_pct: 30, mcv: 90, rdw: 13, alp: 70, wbc: 6 };
  it("is younger than chronological age for healthy markers and older for poor ones", () => {
    expect(phenoAge({ ...base, age: 50 })).toBeLessThan(46);
    expect(phenoAge({ ...base, age: 50, crp: 8, glucose: 115, rdw: 15, albumin: 3.9, wbc: 9 })).toBeGreaterThan(54);
    // monotone in age
    expect(phenoAge({ ...base, age: 60 })).toBeGreaterThan(phenoAge({ ...base, age: 50 }));
  });

  it("matches Greek and English lab names and converts units", () => {
    expect(matchLabKey("Γλυκόζη")).toBe("glucose");
    expect(matchLabKey("Λευκωματίνη ορού")).toBe("albumin");
    expect(matchLabKey("hs-CRP")).toBe("crp");
    expect(matchLabKey("LDL-C")).toBe("ldl");
    expect(matchLabKey("RDW-CV")).toBe("rdw");
    expect(toCanonical("glucose", 5, "mmol/L")).toBeCloseTo(90.08, 1);
    expect(toCanonical("albumin", 45, "g/L")).toBeCloseTo(4.5);
    expect(toCanonical("creatinine", 79.56, "µmol/L")).toBeCloseTo(0.9, 2);
    expect(toCanonical("crp", 0.1, "mg/dL")).toBeCloseTo(1);
    expect(toCanonical("hba1c", 48, "mmol/mol")).toBeCloseTo(6.54, 1);
    expect(toCanonical("glucose", 5, "furlongs")).toBeNull();
  });
});
