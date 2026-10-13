import { all, get } from "../db.js";
import { config } from "../config.js";
import { DAY_MS, zonedDate, zonedToUtc } from "./time.js";

export interface Slot {
  startsAt: number;
  endsAt: number;
}

const MIN_LEAD_MS = 2 * 3600_000; // no same-hour surprises for experts

/** Open slots for an expert over the next `days` days, from weekly availability minus existing bookings. */
export function openSlots(expertId: string, days = 14, now = Date.now()): Slot[] {
  const profile = get<{ session_minutes: number; accepting: number }>(
    "SELECT session_minutes, accepting FROM expert_profiles WHERE user_id = ?",
    expertId,
  );
  if (!profile || !profile.accepting) return [];
  const windows = all<{ weekday: number; start_min: number; end_min: number }>(
    "SELECT weekday, start_min, end_min FROM availability WHERE expert_id = ?",
    expertId,
  );
  const busy = all<{ starts_at: number; ends_at: number }>(
    "SELECT starts_at, ends_at FROM bookings WHERE expert_id = ? AND status = 'booked' AND ends_at > ?",
    expertId,
    now,
  );
  const len = profile.session_minutes;
  const out: Slot[] = [];
  for (let i = 0; i < days; i++) {
    const { date, weekday } = zonedDate(now + i * DAY_MS, config.clinicTimeZone);
    for (const w of windows.filter((w) => w.weekday === weekday)) {
      for (let m = w.start_min; m + len <= w.end_min; m += len) {
        const startsAt = zonedToUtc(date, m, config.clinicTimeZone);
        const endsAt = startsAt + len * 60_000;
        if (startsAt < now + MIN_LEAD_MS) continue;
        if (busy.some((b) => b.starts_at < endsAt && b.ends_at > startsAt)) continue;
        out.push({ startsAt, endsAt });
      }
    }
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}
