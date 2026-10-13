import { Hono, type Context } from "hono";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { all, get, run, tx } from "../db.js";
import { config } from "../config.js";
import { requireUser, type AppEnv } from "../auth.js";
import { isExpert, isLinked } from "../lib/access.js";
import { openSlots } from "../lib/slots.js";
import { newId } from "../lib/ids.js";
import { body, HttpError } from "../lib/validate.js";
import { EXPERT_ROLES } from "../../shared/metrics.js";

export const careRoutes = new Hono<AppEnv>();
careRoutes.use("*", requireUser);

const EXPERT_FIELDS = `u.id, u.name, u.role, p.title, p.bio, p.languages, p.session_minutes, p.accepting`;
const parseExpert = (r: Record<string, unknown>) => ({ ...r, languages: JSON.parse(r.languages as string) });

careRoutes.get("/experts", (c) => {
  const me = c.get("user");
  const rows = all<Record<string, unknown>>(
    `SELECT ${EXPERT_FIELDS},
       EXISTS(SELECT 1 FROM care_team ct WHERE ct.member_id = ? AND ct.expert_id = u.id) AS on_team
     FROM users u JOIN expert_profiles p ON p.user_id = u.id
     WHERE u.role IN (${EXPERT_ROLES.map(() => "?").join(",")})
     ORDER BY on_team DESC, u.role, u.name`,
    me.id,
    ...EXPERT_ROLES,
  );
  return c.json({ experts: rows.map(parseExpert) });
});

careRoutes.get("/experts/:id", (c) => {
  const row = get<Record<string, unknown>>(
    `SELECT ${EXPERT_FIELDS} FROM users u JOIN expert_profiles p ON p.user_id = u.id WHERE u.id = ?`,
    c.req.param("id"),
  );
  if (!row) throw new HttpError(404, "not_found");
  return c.json(parseExpert(row));
});

careRoutes.get("/experts/:id/slots", (c) => {
  const days = Math.min(30, Math.max(1, Number(c.req.query("days") ?? 14)));
  return c.json({ timeZone: config.clinicTimeZone, slots: openSlots(c.req.param("id"), days) });
});

// ---- Bookings ----

const BOOKING_SELECT = `
  SELECT b.id, b.member_id, b.expert_id, b.starts_at, b.ends_at, b.status, b.topic, b.room_url,
         m.name AS member_name, e.name AS expert_name, e.role AS expert_role, p.title AS expert_title
  FROM bookings b
  JOIN users m ON m.id = b.member_id
  JOIN users e ON e.id = b.expert_id
  LEFT JOIN expert_profiles p ON p.user_id = e.id`;

careRoutes.get("/bookings", (c) => {
  const me = c.get("user");
  const col = isExpert(me) ? "b.expert_id" : "b.member_id";
  const scope = c.req.query("scope") ?? "upcoming";
  const cond = scope === "past" ? "b.ends_at < ?" : "b.ends_at >= ?";
  const order = scope === "past" ? "DESC" : "ASC";
  const rows = all(`${BOOKING_SELECT} WHERE ${col} = ? AND ${cond} ORDER BY b.starts_at ${order} LIMIT 50`, me.id, Date.now());
  return c.json({ bookings: rows });
});

careRoutes.post("/bookings", async (c) => {
  const me = c.get("user");
  if (me.role !== "member") throw new HttpError(403, "only_members_book");
  const b = await body(c, z.object({ expertId: z.string(), startsAt: z.number().int(), topic: z.string().max(500).default("") }));
  const id = newId("bk");
  tx(() => {
    // Re-derive slots inside the transaction: the requested start must be an open slot right now.
    const slot = openSlots(b.expertId, 30).find((s) => s.startsAt === b.startsAt);
    if (!slot) throw new HttpError(409, "slot_unavailable");
    const clash = get(
      "SELECT 1 FROM bookings WHERE member_id = ? AND status = 'booked' AND starts_at < ? AND ends_at > ?",
      me.id, slot.endsAt, slot.startsAt,
    );
    if (clash) throw new HttpError(409, "member_busy");
    const room = `${config.videoBaseUrl}/aevum-${randomBytes(9).toString("base64url")}`;
    run(
      "INSERT INTO bookings (id, member_id, expert_id, starts_at, ends_at, status, topic, room_url, created_at) VALUES (?, ?, ?, ?, ?, 'booked', ?, ?, ?)",
      id, me.id, b.expertId, slot.startsAt, slot.endsAt, b.topic, room, Date.now(),
    );
  });
  return c.json(get(`${BOOKING_SELECT} WHERE b.id = ?`, id));
});

function loadBookingFor(c: Context<AppEnv>, id: string) {
  const me = c.get("user");
  const row = get<{ member_id: string; expert_id: string; status: string; starts_at: number } & Record<string, unknown>>(
    `${BOOKING_SELECT} WHERE b.id = ?`,
    id,
  );
  if (!row || (row.member_id !== me.id && row.expert_id !== me.id && me.role !== "admin")) throw new HttpError(404, "not_found");
  return row;
}

careRoutes.get("/bookings/:id", (c) => {
  const me = c.get("user");
  const booking = loadBookingFor(c, c.req.param("id"));
  const notes = all(
    `SELECT n.id, n.content, n.visible_to_member, n.created_at, u.name AS author_name
     FROM session_notes n JOIN users u ON u.id = n.author_id
     WHERE n.booking_id = ? ${me.id === booking.member_id ? "AND n.visible_to_member = 1" : ""}
     ORDER BY n.created_at`,
    booking.id as string,
  );
  return c.json({ ...booking, notes });
});

careRoutes.post("/bookings/:id/cancel", (c) => {
  const booking = loadBookingFor(c, c.req.param("id"));
  if (booking.status !== "booked") throw new HttpError(409, "not_cancellable");
  run("UPDATE bookings SET status = 'cancelled' WHERE id = ?", booking.id as string);
  return c.json({ ok: true });
});

careRoutes.post("/bookings/:id/notes", async (c) => {
  const me = c.get("user");
  const booking = loadBookingFor(c, c.req.param("id"));
  if (booking.expert_id !== me.id) throw new HttpError(403, "only_the_expert_writes_notes");
  const b = await body(c, z.object({ content: z.string().trim().min(1).max(5000), visibleToMember: z.boolean().default(true) }));
  run(
    "INSERT INTO session_notes (id, booking_id, author_id, content, visible_to_member, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId("note"), booking.id as string, me.id, b.content, b.visibleToMember ? 1 : 0, Date.now(),
  );
  if (booking.starts_at < Date.now()) run("UPDATE bookings SET status = 'completed' WHERE id = ? AND status = 'booked'", booking.id as string);
  return c.json({ ok: true });
});

// ---- Messages (async chat between a member and an expert) ----

/** Normalise a thread to (member, expert) whichever side is asking. */
function threadKey(me: AppEnv["Variables"]["user"], otherId: string) {
  const other = get<{ id: string; role: string }>("SELECT id, role FROM users WHERE id = ?", otherId);
  if (!other) throw new HttpError(404, "not_found");
  let key: { memberId: string; expertId: string } | null = null;
  if (isExpert(me) && other.role === "member") key = { memberId: other.id, expertId: me.id };
  if (me.role === "member" && (EXPERT_ROLES as string[]).includes(other.role)) key = { memberId: me.id, expertId: other.id };
  // Messaging is open only between a member and the experts they work with.
  if (!key || !isLinked(key.memberId, key.expertId)) throw new HttpError(403, "not_on_care_team");
  return key;
}

careRoutes.get("/threads", (c) => {
  const me = c.get("user");
  const mine = isExpert(me) ? "expert_id" : "member_id";
  const other = isExpert(me) ? "member_id" : "expert_id";
  const rows = all(
    `SELECT t.other_id, u.name AS other_name, u.role AS other_role, t.last_at,
       (SELECT body FROM messages m WHERE m.${mine} = ? AND m.${other} = t.other_id ORDER BY created_at DESC LIMIT 1) AS last_body,
       (SELECT COUNT(*) FROM messages m WHERE m.${mine} = ? AND m.${other} = t.other_id AND m.sender_id != ? AND m.read_at IS NULL) AS unread
     FROM (SELECT ${other} AS other_id, MAX(created_at) AS last_at FROM messages WHERE ${mine} = ? GROUP BY ${other}) t
     JOIN users u ON u.id = t.other_id ORDER BY t.last_at DESC`,
    me.id, me.id, me.id, me.id,
  );
  return c.json({ threads: rows });
});

careRoutes.get("/threads/:otherId", (c) => {
  const me = c.get("user");
  const { memberId, expertId } = threadKey(me, c.req.param("otherId"));
  run(
    "UPDATE messages SET read_at = ? WHERE member_id = ? AND expert_id = ? AND sender_id != ? AND read_at IS NULL",
    Date.now(), memberId, expertId, me.id,
  );
  const rows = all(
    "SELECT id, sender_id, body, created_at, read_at FROM messages WHERE member_id = ? AND expert_id = ? ORDER BY created_at DESC LIMIT 200",
    memberId, expertId,
  );
  return c.json({ messages: rows.reverse() });
});

careRoutes.post("/threads/:otherId", async (c) => {
  const me = c.get("user");
  const { memberId, expertId } = threadKey(me, c.req.param("otherId"));
  const b = await body(c, z.object({ body: z.string().trim().min(1).max(4000) }));
  const id = newId("msg");
  run(
    "INSERT INTO messages (id, member_id, expert_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, memberId, expertId, me.id, b.body, Date.now(),
  );
  return c.json({ id });
});
