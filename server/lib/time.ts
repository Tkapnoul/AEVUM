export const DAY_MS = 86_400_000;

/** UTC calendar date (YYYY-MM-DD) of a timestamp. */
export const isoDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export const startOfUtcDay = (ts: number) => Math.floor(ts / DAY_MS) * DAY_MS;

/** Offset (ms) of `timeZone` from UTC at instant `ts`. */
export function tzOffset(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** The UTC instant of wall-clock `minutes` after midnight on `date` (YYYY-MM-DD) in `timeZone`. */
export function zonedToUtc(date: string, minutes: number, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d) + minutes * 60_000;
  // Two passes handle instants next to a DST switch.
  const first = guess - tzOffset(guess, timeZone);
  return guess - tzOffset(first, timeZone);
}

/** Calendar date and weekday of `ts` in `timeZone`. */
export function zonedDate(ts: number, timeZone: string): { date: string; weekday: number } {
  const shifted = new Date(ts + tzOffset(ts, timeZone));
  return { date: shifted.toISOString().slice(0, 10), weekday: shifted.getUTCDay() };
}
