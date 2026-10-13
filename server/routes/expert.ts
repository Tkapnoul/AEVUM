import { Hono } from "hono";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { requireRole, requireUser, type AppEnv } from "../auth.js";
import { config } from "../config.js";
import { computeScore } from "../lib/score.js";
import { body } from "../lib/validate.js";
import { EXPERT_ROLES } from "../../shared/metrics.js";

/** Portal for coaches, doctors and other experts. */
export const expertRoutes = new Hono<AppEnv>();
expertRoutes.use("*", requireUser, requireRole(...EXPERT_ROLES, "admin"));

expertRoutes.get("/clients", (c) => {
  const me = c.get("user");
  const rows = all<{ id: string; name: string; email: string; goals: string; on_team: number }>(
    `SELECT u.id, u.name, u.email, u.goals,
       EXISTS(SELECT 1 FROM care_team ct WHERE ct.member_id = u.id AND ct.expert_id = ?) AS on_team
     FROM users u
     WHERE u.id IN (SELECT member_id FROM care_team WHERE expert_id = ?
                    UNION SELECT member_id FROM bookings WHERE expert_id = ? AND status != 'cancelled')
     ORDER BY u.name`,
    me.id, me.id, me.id,
  );
  const now = Date.now();
  return c.json({
    clients: rows.map((r) => ({
      ...r,
      goals: JSON.parse(r.goals),
      score: computeScore(r.id, now).score,
      nextSession: get<{ starts_at: number }>(
        "SELECT starts_at FROM bookings WHERE member_id = ? AND expert_id = ? AND status = 'booked' AND starts_at > ? ORDER BY starts_at LIMIT 1",
        r.id, me.id, now,
      )?.starts_at ?? null,
      lastSync: get<{ t: number | null }>("SELECT MAX(last_sync_at) AS t FROM devices WHERE user_id = ? AND revoked_at IS NULL", r.id)?.t ?? null,
    })),
  });
});

expertRoutes.get("/availability", (c) => {
  const me = c.get("user");
  return c.json({
    timeZone: config.clinicTimeZone,
    profile: get("SELECT title, bio, languages, session_minutes, accepting FROM expert_profiles WHERE user_id = ?", me.id) ?? null,
    windows: all("SELECT weekday, start_min, end_min FROM availability WHERE expert_id = ? ORDER BY weekday, start_min", me.id),
  });
});

const Window = z
  .object({ weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1440), endMin: z.number().int().min(0).max(1440) })
  .refine((w) => w.endMin > w.startMin, "endMin must be after startMin");

expertRoutes.put("/availability", async (c) => {
  const me = c.get("user");
  const b = await body(
    c,
    z.object({
      windows: z.array(Window).max(50),
      sessionMinutes: z.number().int().min(15).max(120).optional(),
      accepting: z.boolean().optional(),
      title: z.string().max(120).optional(),
      bio: z.string().max(2000).optional(),
    }),
  );
  tx(() => {
    if (!get("SELECT 1 FROM expert_profiles WHERE user_id = ?", me.id)) {
      run("INSERT INTO expert_profiles (user_id, title) VALUES (?, ?)", me.id, b.title ?? me.role);
    }
    if (b.sessionMinutes) run("UPDATE expert_profiles SET session_minutes = ? WHERE user_id = ?", b.sessionMinutes, me.id);
    if (b.accepting !== undefined) run("UPDATE expert_profiles SET accepting = ? WHERE user_id = ?", b.accepting ? 1 : 0, me.id);
    if (b.title !== undefined) run("UPDATE expert_profiles SET title = ? WHERE user_id = ?", b.title, me.id);
    if (b.bio !== undefined) run("UPDATE expert_profiles SET bio = ? WHERE user_id = ?", b.bio, me.id);
    run("DELETE FROM availability WHERE expert_id = ?", me.id);
    for (const w of b.windows) {
      run("INSERT INTO availability (expert_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)", me.id, w.weekday, w.startMin, w.endMin);
    }
  });
  return c.json({ ok: true });
});
