// Catalogue of lab markers the app understands. Each marker has one canonical unit;
// results entered in another unit are converted with `factor` (canonical = value × factor)
// or a custom `convert`. Aliases (lower-case substrings) match free-text names from labs.

export type LabKey =
  | "glucose" | "hba1c" | "insulin" | "total_cholesterol" | "ldl" | "hdl" | "triglycerides" | "apob" | "lpa"
  | "crp" | "albumin" | "creatinine" | "egfr" | "cystatin_c" | "uric_acid" | "alp" | "alt" | "ast" | "ggt"
  | "wbc" | "lymphocyte_pct" | "mcv" | "rdw" | "hemoglobin" | "platelets" | "ferritin" | "vitamin_d" | "b12"
  | "tsh" | "testosterone" | "homocysteine";

export interface LabDef {
  key: LabKey;
  name: { el: string; en: string };
  unit: string;
  alt?: Record<string, number | ((v: number) => number)>;
  aliases: string[];
}

const mmolChol = 38.67;

export const LABS: LabDef[] = [
  { key: "glucose", name: { el: "Γλυκόζη νηστείας", en: "Fasting glucose" }, unit: "mg/dL", alt: { "mmol/L": 18.016 }, aliases: ["glucose", "γλυκόζη", "σάκχαρο", "glu"] },
  { key: "hba1c", name: { el: "Γλυκοζυλιωμένη αιμοσφαιρίνη (HbA1c)", en: "HbA1c" }, unit: "%", alt: { "mmol/mol": (v) => v / 10.929 + 2.15 }, aliases: ["hba1c", "a1c", "γλυκοζυλιωμένη"] },
  { key: "insulin", name: { el: "Ινσουλίνη", en: "Insulin" }, unit: "µIU/mL", alt: { "pmol/L": 1 / 6, "mU/L": 1, "uIU/mL": 1 }, aliases: ["insulin", "ινσουλίνη"] },
  { key: "total_cholesterol", name: { el: "Ολική χοληστερόλη", en: "Total cholesterol" }, unit: "mg/dL", alt: { "mmol/L": mmolChol }, aliases: ["total cholesterol", "ολική χοληστερ", "cholesterol total", "χοληστερίνη ολική"] },
  { key: "ldl", name: { el: "LDL χοληστερόλη", en: "LDL cholesterol" }, unit: "mg/dL", alt: { "mmol/L": mmolChol }, aliases: ["ldl"] },
  { key: "hdl", name: { el: "HDL χοληστερόλη", en: "HDL cholesterol" }, unit: "mg/dL", alt: { "mmol/L": mmolChol }, aliases: ["hdl"] },
  { key: "triglycerides", name: { el: "Τριγλυκερίδια", en: "Triglycerides" }, unit: "mg/dL", alt: { "mmol/L": 88.57 }, aliases: ["triglycer", "τριγλυκερίδ"] },
  { key: "apob", name: { el: "Απολιποπρωτεΐνη B", en: "Apolipoprotein B" }, unit: "mg/dL", alt: { "g/L": 100 }, aliases: ["apob", "apo b", "απολιποπρωτεΐνη b", "απολιποπρωτεινη b"] },
  { key: "lpa", name: { el: "Λιποπρωτεΐνη (α)", en: "Lipoprotein(a)" }, unit: "nmol/L", aliases: ["lp(a)", "lpa", "λιποπρωτεΐνη (α)", "λιποπρωτεινη α"] },
  { key: "crp", name: { el: "CRP (C-αντιδρώσα πρωτεΐνη)", en: "CRP (hs-CRP)" }, unit: "mg/L", alt: { "mg/dL": 10 }, aliases: ["crp", "c-reactive", "c-αντιδρώσα", "c αντιδρωσα"] },
  { key: "albumin", name: { el: "Λευκωματίνη", en: "Albumin" }, unit: "g/dL", alt: { "g/L": 0.1 }, aliases: ["albumin", "λευκωματίνη", "αλβουμίνη"] },
  { key: "creatinine", name: { el: "Κρεατινίνη", en: "Creatinine" }, unit: "mg/dL", alt: { "µmol/L": 1 / 88.4, "umol/L": 1 / 88.4 }, aliases: ["creatinine", "κρεατινίνη"] },
  { key: "egfr", name: { el: "eGFR", en: "eGFR" }, unit: "mL/min/1.73m²", aliases: ["egfr", "gfr"] },
  { key: "cystatin_c", name: { el: "Κυστατίνη C", en: "Cystatin C" }, unit: "mg/L", aliases: ["cystatin", "κυστατίνη"] },
  { key: "uric_acid", name: { el: "Ουρικό οξύ", en: "Uric acid" }, unit: "mg/dL", alt: { "µmol/L": 1 / 59.48, "umol/L": 1 / 59.48 }, aliases: ["uric", "ουρικό"] },
  { key: "alp", name: { el: "Αλκαλική φωσφατάση (ALP)", en: "Alkaline phosphatase (ALP)" }, unit: "U/L", alt: { "IU/L": 1 }, aliases: ["alkaline phosph", "alp", "αλκαλική φωσφατάση"] },
  { key: "alt", name: { el: "ALT (SGPT)", en: "ALT" }, unit: "U/L", alt: { "IU/L": 1 }, aliases: ["alt", "sgpt", "αλανινική"] },
  { key: "ast", name: { el: "AST (SGOT)", en: "AST" }, unit: "U/L", alt: { "IU/L": 1 }, aliases: ["ast", "sgot", "ασπαρτική"] },
  { key: "ggt", name: { el: "γ-GT", en: "GGT" }, unit: "U/L", alt: { "IU/L": 1 }, aliases: ["ggt", "γ-gt", "γgt", "gamma-gt"] },
  { key: "wbc", name: { el: "Λευκά αιμοσφαίρια (WBC)", en: "White blood cells (WBC)" }, unit: "10³/µL", alt: { "10^9/L": 1, "/µL": 0.001, "/uL": 0.001, "K/µL": 1 }, aliases: ["wbc", "white blood", "λευκά αιμοσφαίρια", "λευκοκύτταρα"] },
  { key: "lymphocyte_pct", name: { el: "Λεμφοκύτταρα %", en: "Lymphocytes %" }, unit: "%", aliases: ["lymph", "λεμφοκύτταρα", "lym%"] },
  { key: "mcv", name: { el: "MCV", en: "MCV" }, unit: "fL", aliases: ["mcv", "μέσος όγκος"] },
  { key: "rdw", name: { el: "RDW", en: "RDW" }, unit: "%", aliases: ["rdw"] },
  { key: "hemoglobin", name: { el: "Αιμοσφαιρίνη", en: "Hemoglobin" }, unit: "g/dL", alt: { "g/L": 0.1 }, aliases: ["hemoglobin", "haemoglobin", "αιμοσφαιρίνη", "hgb"] },
  { key: "platelets", name: { el: "Αιμοπετάλια", en: "Platelets" }, unit: "10³/µL", alt: { "10^9/L": 1 }, aliases: ["platelet", "αιμοπετάλια", "plt"] },
  { key: "ferritin", name: { el: "Φερριτίνη", en: "Ferritin" }, unit: "ng/mL", alt: { "µg/L": 1, "ug/L": 1 }, aliases: ["ferritin", "φερριτίνη"] },
  { key: "vitamin_d", name: { el: "Βιταμίνη D (25-OH)", en: "Vitamin D (25-OH)" }, unit: "ng/mL", alt: { "nmol/L": 1 / 2.496 }, aliases: ["vitamin d", "25-oh", "βιταμίνη d", "25(oh)"] },
  { key: "b12", name: { el: "Βιταμίνη B12", en: "Vitamin B12" }, unit: "pg/mL", alt: { "pmol/L": 1.355 }, aliases: ["b12", "κοβαλαμίνη", "cobalamin"] },
  { key: "tsh", name: { el: "TSH", en: "TSH" }, unit: "mIU/L", alt: { "µIU/mL": 1, "uIU/mL": 1 }, aliases: ["tsh", "θυρεοειδοτρόπος"] },
  { key: "testosterone", name: { el: "Τεστοστερόνη", en: "Testosterone" }, unit: "ng/dL", alt: { "nmol/L": 28.84, "ng/mL": 100 }, aliases: ["testosterone", "τεστοστερόνη"] },
  { key: "homocysteine", name: { el: "Ομοκυστεΐνη", en: "Homocysteine" }, unit: "µmol/L", alt: { "umol/L": 1 }, aliases: ["homocyst", "ομοκυστεΐνη", "ομοκυστεινη"] },
];

export const LAB_KEYS = LABS.map((l) => l.key) as [LabKey, ...LabKey[]];
export const labDef = (key: string) => LABS.find((l) => l.key === key);

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Best-effort match of a printed marker name to a catalogue key. */
export function matchLabKey(name: string): LabKey | null {
  const n = norm(name);
  // Longest alias wins, so "hdl" inside "non-hdl" style names doesn't beat a more specific alias.
  let best: { key: LabKey; len: number } | null = null;
  for (const l of LABS) {
    for (const a of l.aliases) {
      const na = norm(a);
      const hit = na.length <= 3 ? new RegExp(`(^|[^a-z])${na.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(n) : n.includes(na);
      if (hit && (!best || na.length > best.len)) best = { key: l.key, len: na.length };
    }
  }
  return best?.key ?? null;
}

/** Convert a value to the marker's canonical unit. Returns null for unknown units. */
export function toCanonical(key: LabKey, value: number, unit: string): number | null {
  const def = labDef(key)!;
  const u = unit.replace(/\s+/g, "").replace("μ", "µ");
  if (u.toLowerCase() === def.unit.replace(/\s+/g, "").toLowerCase() || !u) return value;
  for (const [alt, f] of Object.entries(def.alt ?? {})) {
    if (alt.toLowerCase() === u.toLowerCase()) return typeof f === "function" ? f(value) : value * f;
  }
  return null;
}
