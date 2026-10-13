import { all, get } from "../db.js";
import { dailySeries, lastSleep, mean } from "../lib/metrics-store.js";
import { computeScore } from "../lib/score.js";
import { company } from "../../shared/company.js";

const round = (x: number | null, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * Plain-text snapshot of the member, frozen at the start of each AI conversation.
 * Detailed history is fetched on demand through tools.
 */
export function memberSnapshot(userId: string, now = Date.now()): string {
  const u = get<{ name: string; birth_date: string | null; sex: string | null; height_cm: number | null; goals: string; locale: string; plan: string | null }>(
    "SELECT name, birth_date, sex, height_cm, goals, locale, plan FROM users WHERE id = ?",
    userId,
  )!;
  const age = u.birth_date ? Math.floor((now - Date.parse(u.birth_date)) / (365.25 * 86_400_000)) : null;
  const goals = (JSON.parse(u.goals) as string[]).map((g) => company.goals.find((x) => x.key === g)?.label.en ?? g);
  const score = computeScore(userId, now);
  const avg = (type: Parameters<typeof dailySeries>[1], days: number) => round(mean(dailySeries(userId, type, days, now).map((p) => p.value)));
  const sleep = lastSleep(userId);
  const device = get<{ name: string; last_sync_at: number | null }>(
    "SELECT name, last_sync_at FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_sync_at DESC LIMIT 1",
    userId,
  );
  const team = all<{ name: string; role: string; title: string }>(
    `SELECT u.name, u.role, p.title FROM care_team ct JOIN users u ON u.id = ct.expert_id
     LEFT JOIN expert_profiles p ON p.user_id = u.id WHERE ct.member_id = ?`,
    userId,
  );
  const upcoming = all<{ starts_at: number; name: string; role: string; topic: string }>(
    `SELECT b.starts_at, u.name, u.role, b.topic FROM bookings b JOIN users u ON u.id = b.expert_id
     WHERE b.member_id = ? AND b.status = 'booked' AND b.starts_at > ? ORDER BY b.starts_at LIMIT 3`,
    userId, now,
  );

  const lines = [
    `Snapshot taken: ${new Date(now).toISOString()}`,
    `Member: ${u.name}${age != null ? `, ${age} y` : ""}${u.sex ? `, ${u.sex}` : ""}${u.height_cm ? `, ${u.height_cm} cm` : ""}`,
    `Preferred language: ${u.locale === "el" ? "Greek" : "English"}`,
    `Goals: ${goals.length ? goals.join(", ") : "not set"}`,
    `Wearable: ${device ? `${device.name}, last sync ${device.last_sync_at ? new Date(device.last_sync_at).toISOString() : "never"}` : "none connected"}`,
    `AEVUM score (7-day vs 30-day baseline): ${score.score ?? "not enough data"} — ${score.components.map((c) => `${c.key} ${c.score ?? "n/a"}`).join(", ")}`,
    `7-day averages: steps ${avg("steps", 7) ?? "n/a"}, resting HR ${avg("resting_hr", 7) ?? "n/a"} bpm, sleep ${avg("sleep_minutes", 7) ?? "n/a"} min, stress ${avg("stress", 7) ?? "n/a"}/100, SpO2 ${avg("spo2", 7) ?? "n/a"}%`,
    `30-day averages: steps ${avg("steps", 30) ?? "n/a"}, resting HR ${avg("resting_hr", 30) ?? "n/a"} bpm, sleep ${avg("sleep_minutes", 30) ?? "n/a"} min, stress ${avg("stress", 30) ?? "n/a"}/100`,
    `Last night: ${sleep ? `${sleep.date}, ${sleep.total_min} min total, deep ${sleep.deep_min ?? "n/a"} min, score ${sleep.score ?? "n/a"}` : "no sleep data"}`,
    `Care team: ${team.length ? team.map((t) => `${t.name} (${t.title || t.role})`).join("; ") : "none assigned"}`,
    `Upcoming sessions: ${upcoming.length ? upcoming.map((b) => `${new Date(b.starts_at).toISOString()} with ${b.name} (${b.role})${b.topic ? ` — ${b.topic}` : ""}`).join("; ") : "none"}`,
  ];
  return lines.join("\n");
}
