import { LABS, labDef, type LabKey } from "./labs.js";

// Turns the plain text of a lab report (from a PDF's text layer or OCR) into result rows.
// Lab reports are tables: one test per line, name first, then value, unit and reference range.
// Everything found here is a suggestion the member reviews before saving.

export interface ParsedLab {
  markerKey: LabKey;
  marker: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
}

export interface ParsedReport {
  takenAt: string | null; // YYYY-MM-DD
  results: ParsedLab[];
}

// OCR often reads Latin capitals in Greek documents as their Greek look-alikes (ΗDL, ΑLT, CRΡ…).
const LOOKALIKE: Record<string, string> = { Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X" };
const latinize = (s: string) => s.replace(/[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]/g, (ch) => LOOKALIKE[ch]);
// Accents are stripped per character (NFD + remove marks), which keeps string offsets aligned with the
// original line for precomposed Greek/Latin letters.
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ALIASES = LABS.flatMap((l) => l.aliases.map((a) => ({ key: l.key, alias: norm(a) }))).sort((a, b) => b.alias.length - a.alias.length);

/** Longest alias found in the line, and where it ends (offset in the normalised line). */
function findMarker(line: string): { key: LabKey; end: number; text: string } | null {
  for (const variant of [line, latinize(line)]) {
    const n = norm(variant);
    for (const { key, alias } of ALIASES) {
      const re = alias.length <= 3 ? new RegExp(`(^|[^a-z0-9α-ω])${esc(alias)}(?![a-zα-ω])`) : new RegExp(esc(alias));
      const m = re.exec(n);
      if (m) return { key, end: m.index + m[0].length, text: n };
    }
  }
  return null;
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const toNum = (s: string) => Number(s.replace(",", "."));

// Unit tokens that may follow a value (longest first so "mg/dL" beats "mg"). Matched on the normalised (lower-case) text.
const UNITS = [
  "miu/l", "µiu/ml", "μiu/ml", "uiu/ml", "mu/l",
  "mmol/mol", "mmol/l", "µmol/l", "μmol/l", "umol/l", "nmol/l", "pmol/l",
  "mg/dl", "g/dl", "mg/l", "g/l", "ng/ml", "ng/dl", "pg/ml", "µg/l", "μg/l", "ug/l",
  "iu/l", "u/l", "fl",
  "x10^9/l", "10^9/l", "x10^3/µl", "x10^3/μl", "10^3/µl", "10^3/μl", "10³/µl", "10³/μl", "k/µl", "k/ul", "/µl", "/μl", "/ul", "/mm3", "/mm³",
  "ml/min/1.73m²", "ml/min/1.73 m²", "ml/min/1.73m2", "ml/min",
  "%",
];
const UNIT_RE = new RegExp(String.raw`^\s*(` + UNITS.map(esc).join("|") + ")", "i");

function canonicalUnit(key: LabKey, raw: string): string {
  const def = labDef(key)!;
  const u = raw.replace(/\s+/g, "").replace(/μ/g, "µ").replace(/^x/i, "");
  const known = [def.unit, ...Object.keys(def.alt ?? {})];
  const hit = known.find((k) => k.replace(/\s+/g, "").replace(/μ/g, "µ").toLowerCase() === u.toLowerCase());
  if (hit) return hit;
  if (/^(10\^3|10³|k)\/[µu]l$/i.test(u) || /^\/mm[3³]$/i.test(u)) return def.unit === "10³/µL" ? def.unit : u;
  if (/^10\^9\/l$/i.test(u)) return "10^9/L";
  return u;
}

/** One line → one result, or null when the line isn't a recognisable numeric result. */
export function parseLine(line: string): ParsedLab | null {
  const hit = findMarker(line);
  if (!hit) return null;
  let rest = hit.text
    .slice(hit.end)
    // Common OCR slips in units: "mg/d|", "mg/dI" → mg/dl.
    .replace(/\/d[|i1](?![a-z])/g, "/dl");
  // OCR reads a "%" right after "Λεμφοκύτταρα" as "96"/"9" when it precedes the value.
  if (hit.key === "lymphocyte_pct") rest = rest.replace(/^\s*(?:%|96|9)\s+(?=\d)/, " % ");
  // The value is the first number that stands on its own: skips digits glued to the name ("B12", "HbA1c"),
  // name qualifiers like "(25-OH)", exponents ("10^3") and the start of a range ("70 - 110").
  const valueRe = new RegExp(String.raw`(?:^|[\s:=*|(])[<>≤≥]?\s*(${NUM})(?![\d^/-]|\s*[–—-]\s*\d)`, "g");
  const vm = valueRe.exec(rest);
  if (!vm) return null;
  let value = toNum(vm[1]);
  if (!Number.isFinite(value)) return null;
  let after = rest.slice(vm.index + vm[0].length);

  let unit = "";
  const um = UNIT_RE.exec(after);
  if (um) {
    unit = canonicalUnit(hit.key, um[1]);
    after = after.slice(um[0].length);
  }

  // OCR sometimes drops the decimal separator ("31,4" → "314"); a percentage can't exceed 100.
  if ((unit === "%" || labDef(hit.key)!.unit === "%") && value > 100 && !vm[1].includes(".") && !vm[1].includes(",")) {
    while (value > 100) value /= 10;
  }

  // Lymphocytes appear twice in a blood count: as % and as an absolute count. Only the % belongs here.
  if (hit.key === "lymphocyte_pct" && unit !== "%" && !hit.text.slice(0, hit.end).includes("%") && !rest.startsWith(" % ")) return null;

  let refLow: number | null = null;
  let refHigh: number | null = null;
  const range = new RegExp(String.raw`(${NUM})\s*[-–—]\s*(${NUM})`).exec(after);
  if (range) {
    refLow = toNum(range[1]);
    refHigh = toNum(range[2]);
  } else {
    const lt = new RegExp(String.raw`(?:<|≤|εως|μεχρι|up to)\s*(${NUM})`).exec(after);
    const gt = new RegExp(String.raw`(?:>|≥|απο|over)\s*(${NUM})`).exec(after);
    if (lt) refHigh = toNum(lt[1]);
    else if (gt) refLow = toNum(gt[1]);
  }
  if (refLow != null && refHigh != null && refLow > refHigh) [refLow, refHigh] = [null, null];

  const name = line.slice(0, hit.end).replace(/[\s:.*|]+$/, "").trim();
  return { markerKey: hit.key, marker: name.slice(0, 80) || labDef(hit.key)!.name.en, value, unit, refLow, refHigh };
}

/** First plausible date in the text (dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy or yyyy-mm-dd), not in the future. */
export function findDate(text: string, now = Date.now()): string | null {
  const re = /\b(?:(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})|(\d{4})-(\d{2})-(\d{2}))\b/g;
  for (let m; (m = re.exec(text)); ) {
    const [y, mo, d] = m[4] ? [+m[4], +m[5], +m[6]] : [m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const t = Date.UTC(y, mo - 1, d);
    if (t > now + 86_400_000 || t < now - 10 * 365 * 86_400_000) continue;
    return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

export function parseLabText(text: string, now = Date.now()): ParsedReport {
  const results: ParsedLab[] = [];
  const seen = new Set<LabKey>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 3 || line.length > 200) continue;
    const r = parseLine(line);
    // A report can repeat a test (previous results, comments); the first occurrence is the current one.
    if (r && !seen.has(r.markerKey)) {
      seen.add(r.markerKey);
      results.push(r);
    }
  }
  return { takenAt: findDate(text, now), results };
}
