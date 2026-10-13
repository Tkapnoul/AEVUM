import { Hono } from "hono";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { requireAdmin, requireUser, type AppEnv } from "../auth.js";
import { body, HttpError } from "../lib/validate.js";
import { EXPERT_ROLES } from "../../shared/metrics.js";

/** Small-group administration: who is a coach/doctor, who else is admin. */
export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireUser, requireAdmin);

adminRoutes.get("/users", (c) =>
  c.json({
    users: all(
      `SELECT u.id, u.name, u.email, u.role, u.is_admin, u.created_at,
         (SELECT MAX(last_sync_at) FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL) AS last_sync
       FROM users u ORDER BY u.created_at`,
    ),
  }),
);

const DEFAULT_TITLES: Record<string, string> = { coach: "Coach", doctor: "Doctor", nutritionist: "Nutritionist", physio: "Physiotherapist" };

adminRoutes.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const b = await body(
    c,
    z.object({ role: z.enum(["member", "coach", "doctor", "nutritionist", "physio"]).optional(), isAdmin: z.boolean().optional() }),
  );
  const user = get<{ id: string; is_admin: number }>("SELECT id, is_admin FROM users WHERE id = ?", id);
  if (!user) throw new HttpError(404, "not_found");
  if (b.isAdmin === false && id === c.get("user").id) throw new HttpError(400, "cannot_remove_own_admin");
  tx(() => {
    if (b.isAdmin !== undefined) run("UPDATE users SET is_admin = ? WHERE id = ?", b.isAdmin ? 1 : 0, id);
    if (!b.role) return;
    run("UPDATE users SET role = ? WHERE id = ?", b.role, id);
    if (!(EXPERT_ROLES as string[]).includes(b.role)) return;
    // A new expert is bookable straight away: default profile, Mon–Fri 09:00–17:00, on everyone's care team.
    if (!get("SELECT 1 FROM expert_profiles WHERE user_id = ?", id)) {
      run("INSERT INTO expert_profiles (user_id, title) VALUES (?, ?)", id, DEFAULT_TITLES[b.role]);
      for (let wd = 1; wd <= 5; wd++) run("INSERT INTO availability (expert_id, weekday, start_min, end_min) VALUES (?, ?, 540, 1020)", id, wd);
    }
    for (const m of all<{ id: string }>("SELECT id FROM users WHERE role = 'member'")) {
      const hasRole = get(
        "SELECT 1 FROM care_team ct JOIN users e ON e.id = ct.expert_id WHERE ct.member_id = ? AND e.role = ?",
        m.id, b.role,
      );
      if (!hasRole) run("INSERT OR IGNORE INTO care_team (member_id, expert_id, is_primary, created_at) VALUES (?, ?, 1, ?)", m.id, id, Date.now());
    }
  });
  return c.json({ ok: true });
});
