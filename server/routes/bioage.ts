import { Hono, type Context } from "hono";
import { all, get, run } from "../db.js";
import { requireUser, type AppEnv } from "../auth.js";
import { canViewMember } from "../lib/access.js";
import { newId } from "../lib/ids.js";
import { HttpError, rateLimit } from "../lib/validate.js";
import { anthropic } from "../ai/client.js";
import { chronoAge, runBioAge, type BioAgeReport } from "../ai/bioage.js";
import { phenoAgeFor, PHENOAGE_MARKERS } from "../lib/phenoage.js";

export const bioAgeRoutes = new Hono<AppEnv>();
bioAgeRoutes.use("*", requireUser);

function subject(c: Context<AppEnv>) {
  const viewer = c.get("user");
  const memberId = c.req.query("member") ?? viewer.id;
  if (!canViewMember(viewer, memberId)) throw new HttpError(403, "forbidden");
  return memberId;
}

interface Row {
  id: string;
  status: "pending" | "done" | "error";
  chrono_age: number;
  phenoage: number | null;
  result: string | null;
  error: string | null;
  created_at: number;
}

const view = (r: Row) => ({
  id: r.id,
  status: r.status,
  chronoAge: r.chrono_age,
  phenoAge: r.phenoage,
  report: r.result ? (JSON.parse(r.result) as BioAgeReport) : null,
  error: r.error,
  createdAt: r.created_at,
});

bioAgeRoutes.get("/", (c) => {
  const userId = subject(c);
  const birth = get<{ birth_date: string | null }>("SELECT birth_date FROM users WHERE id = ?", userId)?.birth_date ?? null;
  const age = chronoAge(birth);
  const rows = all<Row>("SELECT * FROM bio_age_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", userId);
  const latest = rows.find((r) => r.status !== "error") ?? rows[0];
  const done = rows.filter((r) => r.status === "done").reverse();
  // Pace of ageing: change in bio age per calendar year, between the first and latest report ≥ 30 days apart.
  let pace: number | null = null;
  if (done.length >= 2) {
    const a = done[0];
    const b = done[done.length - 1];
    const years = (b.created_at - a.created_at) / (365.2425 * 86_400_000);
    if (years >= 30 / 365) pace = Math.round(((view(b).report!.overall_bio_age - view(a).report!.overall_bio_age) / years) * 100) / 100;
  }
  return c.json({
    aiEnabled: Boolean(anthropic),
    birthDateMissing: birth == null,
    chronoAge: age == null ? null : Math.round(age * 10) / 10,
    phenoAge: { ...phenoAgeFor(userId, age), required: PHENOAGE_MARKERS },
    latest: latest ? view(latest) : null,
    latestDone: rows.find((r) => r.status === "done") ? view(rows.find((r) => r.status === "done")!) : null,
    history: done.map((r) => ({ createdAt: r.created_at, bioAge: view(r).report!.overall_bio_age, chronoAge: r.chrono_age, phenoAge: r.phenoage })),
    pace,
  });
});

bioAgeRoutes.post("/", (c) => {
  const userId = c.get("user").id;
  if (!anthropic) throw new HttpError(503, "ai_not_configured");
  const birth = get<{ birth_date: string | null }>("SELECT birth_date FROM users WHERE id = ?", userId)?.birth_date ?? null;
  const age = chronoAge(birth);
  if (age == null) throw new HttpError(400, "birth_date_required");
  if (get("SELECT 1 FROM bio_age_reports WHERE user_id = ? AND status = 'pending'", userId)) throw new HttpError(409, "already_running");
  rateLimit(`bioage:${userId}`, 6, 24 * 3600_000);
  const id = newId("bio");
  run(
    "INSERT INTO bio_age_reports (id, user_id, status, chrono_age, phenoage, created_at) VALUES (?, ?, 'pending', ?, ?, ?)",
    id, userId, Math.round(age * 10) / 10, phenoAgeFor(userId, age).value, Date.now(),
  );
  void runBioAge(id, userId); // background; the app polls GET /bioage/:id
  return c.json({ id });
});

bioAgeRoutes.get("/:id", (c) => {
  const userId = subject(c);
  const r = get<Row>("SELECT * FROM bio_age_reports WHERE id = ? AND user_id = ?", c.req.param("id"), userId);
  if (!r) throw new HttpError(404, "not_found");
  return c.json(view(r));
});
