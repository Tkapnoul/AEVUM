import { Hono, type Context } from "hono";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { run, tx } from "../db.js";
import { aiProvider, config } from "../config.js";
import { completeJson } from "../ai/free.js";
import { requireUser, type AppEnv } from "../auth.js";
import { canViewMember } from "../lib/access.js";
import { newId } from "../lib/ids.js";
import { body, HttpError, rateLimit } from "../lib/validate.js";
import { anthropic, FALLBACK } from "../ai/client.js";
import { LABS, LAB_KEYS, matchLabKey } from "../../shared/labs.js";

export const labRoutes = new Hono<AppEnv>();
labRoutes.use("*", requireUser);

/** Members manage their own labs; among experts only doctors write them. */
function writableSubject(c: Context<AppEnv>) {
  const viewer = c.get("user");
  const memberId = c.req.query("member") ?? viewer.id;
  if (!canViewMember(viewer, memberId)) throw new HttpError(403, "forbidden");
  if (viewer.id !== memberId && viewer.role !== "doctor" && !viewer.is_admin) throw new HttpError(403, "forbidden");
  return memberId;
}

labRoutes.get("/catalogue", (c) => c.json({ labs: LABS.map((l) => ({ key: l.key, name: l.name, unit: l.unit, altUnits: Object.keys(l.alt ?? {}) })) }));

const Result = z.object({
  markerKey: z.enum(LAB_KEYS).nullable(),
  marker: z.string().trim().min(1).max(80),
  value: z.number(),
  unit: z.string().trim().max(20),
  refLow: z.number().nullable().optional(),
  refHigh: z.number().nullable().optional(),
});

labRoutes.post("/batch", async (c) => {
  const userId = writableSubject(c);
  const b = await body(c, z.object({ takenAt: z.iso.date(), note: z.string().max(500).default(""), results: z.array(Result).min(1).max(150) }));
  const takenAt = Date.parse(`${b.takenAt}T00:00:00Z`);
  tx(() => {
    for (const r of b.results) {
      run(
        "INSERT INTO labs (id, user_id, marker, marker_key, value, unit, ref_low, ref_high, taken_at, entered_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        newId("lab"), userId, r.marker, r.markerKey ?? matchLabKey(r.marker), r.value, r.unit, r.refLow ?? null, r.refHigh ?? null,
        takenAt, c.get("user").id, b.note,
      );
    }
  });
  return c.json({ ok: true, saved: b.results.length });
});

labRoutes.delete("/:id", (c) => {
  const userId = writableSubject(c);
  const res = run("DELETE FROM labs WHERE id = ? AND user_id = ?", c.req.param("id"), userId);
  if (!res.changes) throw new HttpError(404, "not_found");
  return c.json({ ok: true });
});

// ---- AI extraction from a photo or PDF of a lab report ----

const Extraction = z.object({
  taken_at: z.string().nullable().describe("Sample collection date as YYYY-MM-DD, or null if not printed"),
  lab_name: z.string().nullable(),
  results: z.array(
    z.object({
      marker_key: z.enum([...LAB_KEYS, "other"]).describe("Catalogue key, or 'other' when the test is not in the catalogue"),
      name_as_printed: z.string(),
      value: z.number().describe("Numeric result. For '<0.5' style results use the limit value."),
      unit: z.string().describe("Unit exactly as printed, e.g. mg/dL, mmol/L, 10^3/µL, %"),
      ref_low: z.number().nullable(),
      ref_high: z.number().nullable(),
    }),
  ),
});

const EXTRACT_PROMPT = `Extract every numeric test result from this laboratory report (it may be in Greek or English).
Map each test to one of these catalogue keys when it is the same test, otherwise use "other":
${LABS.map((l) => `- ${l.key}: ${l.name.en} / ${l.name.el} (canonical unit ${l.unit})`).join("\n")}
Notes: hs-CRP and CRP both map to "crp". "Λεμφοκύτταρα %" (percentage) maps to lymphocyte_pct; ignore absolute lymphocyte counts for that key and use "other".
Copy the unit exactly as printed; do not convert values. Use the printed reference range when present.
Skip qualitative results (positive/negative) and anything that is not a measured value.`;

const MEDIA = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "document",
} as const;

const toReview = (out: z.infer<typeof Extraction>) => ({
  takenAt: out.taken_at && /^\d{4}-\d{2}-\d{2}$/.test(out.taken_at) ? out.taken_at : null,
  labName: out.lab_name,
  results: out.results.map((r) => ({
    markerKey: r.marker_key === "other" ? null : r.marker_key,
    marker: r.name_as_printed.slice(0, 80),
    value: r.value,
    unit: r.unit.slice(0, 20),
    refLow: r.ref_low,
    refHigh: r.ref_high,
  })),
});

/** Structures report text the app already read on the device (PDF text layer or OCR). Works with the free provider. */
labRoutes.post("/structure", async (c) => {
  if (!aiProvider) throw new HttpError(503, "ai_not_configured");
  writableSubject(c);
  rateLimit(`extract:${c.get("user").id}`, 20, 3600_000);
  const { text } = await body(c, z.object({ text: z.string().trim().min(10).max(60_000) }));
  const prompt = `${EXTRACT_PROMPT}\nThe report text below was read by OCR or from a PDF; fix obvious OCR slips (O↔0, l↔1, Greek look-alike letters) but never invent values.\n\n<report>\n${text}\n</report>`;
  try {
    let out: z.infer<typeof Extraction> | null;
    if (aiProvider === "free") {
      out = await completeJson([{ role: "user", content: prompt }], "lab_extraction", z.toJSONSchema(Extraction), (x) => {
        const r = Extraction.safeParse(x);
        return r.success ? r.data : null;
      });
    } else {
      const msg = await anthropic!.beta.messages.parse({
        model: config.ai.model,
        max_tokens: 16000,
        output_config: { effort: "low", format: betaZodOutputFormat(Extraction) },
        messages: [{ role: "user", content: prompt }],
        ...FALLBACK,
      });
      out = msg.stop_reason === "refusal" ? null : msg.parsed_output;
    }
    if (!out) throw new HttpError(400, "could_not_read");
    return c.json(toReview(out));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("[labs] structuring failed", err);
    throw new HttpError(503, "ai_failed");
  }
});

labRoutes.post("/extract", async (c) => {
  if (!anthropic) throw new HttpError(503, "ai_not_configured");
  writableSubject(c);
  rateLimit(`extract:${c.get("user").id}`, 20, 3600_000);
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "file_required");
  const kind = MEDIA[file.type as keyof typeof MEDIA];
  if (!kind) throw new HttpError(400, "unsupported_file_type");
  if (file.size > 15 * 1024 * 1024) throw new HttpError(400, "file_too_large");
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");

  const block: Anthropic.Beta.BetaContentBlockParam =
    kind === "document"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } };

  try {
    const msg = await anthropic.beta.messages.parse({
      model: config.ai.model,
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(Extraction) },
      messages: [{ role: "user", content: [block, { type: "text", text: EXTRACT_PROMPT }] }],
      ...FALLBACK,
    });
    if (msg.stop_reason === "refusal") throw new HttpError(400, "could_not_read");
    const out = msg.parsed_output;
    if (!out) throw new HttpError(400, "could_not_read");
    return c.json(toReview(out));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("[labs] extraction failed", err);
    throw new HttpError(503, "ai_failed");
  }
});

