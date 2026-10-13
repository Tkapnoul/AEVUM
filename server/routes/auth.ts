import { Hono } from "hono";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { endSession, hashPassword, requireUser, startSession, verifyPassword, type AppEnv } from "../auth.js";
import { newId } from "../lib/ids.js";
import { body, HttpError, rateLimit } from "../lib/validate.js";
import { company } from "../../shared/company.js";

export const authRoutes = new Hono<AppEnv>();

const Register = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(200),
  password: z.string().min(8).max(200),
  locale: z.enum(["el", "en"]).default("el"),
  birthDate: z.iso.date().optional(),
  sex: z.enum(["female", "male", "other"]).optional(),
  heightCm: z.number().min(100).max(250).optional(),
  goals: z.array(z.string().max(40)).max(10).default([]),
  consent: z.literal(true),
});

authRoutes.post("/register", async (c) => {
  rateLimit(`register:${c.req.header("x-forwarded-for") ?? "local"}`, 10, 3600_000);
  const b = await body(c, Register);
  if (get("SELECT 1 FROM users WHERE email = ?", b.email)) throw new HttpError(409, "email_taken");
  const id = newId("u");
  const hash = await hashPassword(b.password);
  tx(() => {
    run(
      `INSERT INTO users (id, email, password_hash, name, role, locale, birth_date, sex, height_cm, goals, plan, consent_at, created_at)
       VALUES (?, ?, ?, ?, 'member', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, b.email, hash, b.name, b.locale, b.birthDate ?? null, b.sex ?? null, b.heightCm ?? null,
      JSON.stringify(b.goals), company.plans[0]?.id ?? null, Date.now(), Date.now(),
    );
    // Every new member is matched with one expert per role in the company's default
    // care-team model (e.g. a coach and a doctor), picking whoever has the fewest members.
    for (const role of company.careTeamRoles) {
      const expert = get<{ id: string }>(
        `SELECT u.id FROM users u JOIN expert_profiles p ON p.user_id = u.id
         WHERE u.role = ? AND p.accepting = 1
         ORDER BY (SELECT COUNT(*) FROM care_team ct WHERE ct.expert_id = u.id) ASC LIMIT 1`,
        role,
      );
      if (expert) run("INSERT INTO care_team (member_id, expert_id, is_primary, created_at) VALUES (?, ?, 1, ?)", id, expert.id, Date.now());
    }
  });
  await startSession(c, id);
  return c.json({ ok: true });
});

authRoutes.post("/login", async (c) => {
  const b = await body(c, z.object({ email: z.string().max(200), password: z.string().max(200) }));
  rateLimit(`login:${b.email.toLowerCase()}`, 10, 15 * 60_000);
  const u = get<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", b.email);
  if (!u || !(await verifyPassword(b.password, u.password_hash))) throw new HttpError(401, "invalid_credentials");
  await startSession(c, u.id);
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  endSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, (c) => {
  const u = get<Record<string, unknown>>(
    "SELECT id, email, name, role, locale, birth_date, sex, height_cm, goals, plan, created_at FROM users WHERE id = ?",
    c.get("user").id,
  )!;
  return c.json({ ...u, goals: JSON.parse(u.goals as string) });
});

authRoutes.patch("/me", requireUser, async (c) => {
  const b = await body(
    c,
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      locale: z.enum(["el", "en"]).optional(),
      birthDate: z.iso.date().nullable().optional(),
      sex: z.enum(["female", "male", "other"]).nullable().optional(),
      heightCm: z.number().min(100).max(250).nullable().optional(),
      goals: z.array(z.string().max(40)).max(10).optional(),
    }),
  );
  const id = c.get("user").id;
  const map: [string, unknown][] = [
    ["name", b.name], ["locale", b.locale], ["birth_date", b.birthDate], ["sex", b.sex],
    ["height_cm", b.heightCm], ["goals", b.goals && JSON.stringify(b.goals)],
  ];
  for (const [col, v] of map) if (v !== undefined) run(`UPDATE users SET ${col} = ? WHERE id = ?`, v as string | number | null, id);
  return c.json({ ok: true });
});

// GDPR: data portability.
authRoutes.get("/me/export", requireUser, (c) => {
  const id = c.get("user").id;
  const data = {
    exportedAt: new Date().toISOString(),
    profile: get("SELECT id, email, name, role, locale, birth_date, sex, height_cm, goals, plan, created_at FROM users WHERE id = ?", id),
    metrics: all("SELECT type, ts, value, source FROM metrics WHERE user_id = ? ORDER BY ts", id),
    sleep: all("SELECT * FROM sleep_sessions WHERE user_id = ? ORDER BY date", id),
    labs: all("SELECT marker, value, unit, ref_low, ref_high, taken_at, note FROM labs WHERE user_id = ?", id),
    bookings: all("SELECT id, expert_id, starts_at, ends_at, status, topic FROM bookings WHERE member_id = ?", id),
    messages: all("SELECT expert_id, sender_id, body, created_at FROM messages WHERE member_id = ?", id),
    aiConversation: all("SELECT role, content, created_at FROM ai_messages WHERE user_id = ?", id),
  };
  c.header("Content-Disposition", `attachment; filename="aevum-export-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json(data);
});

// GDPR: erasure. Cascades through every table keyed on the user.
authRoutes.delete("/me", requireUser, async (c) => {
  const b = await body(c, z.object({ password: z.string() }));
  const u = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", c.get("user").id)!;
  if (!(await verifyPassword(b.password, u.password_hash))) throw new HttpError(401, "invalid_credentials");
  run("DELETE FROM users WHERE id = ?", c.get("user").id);
  endSession(c);
  return c.json({ ok: true });
});
