// Turns raw sleep segments (from Apple Health, Health Connect or an Apple Health export)
// into one main sleep per night. Several sources often record the same night (iPhone + watch);
// the most detailed one wins instead of adding them up.

/** state: inBed | asleep | light | deep | rem | awake */
export interface RawSleep {
  start: number;
  end: number;
  state: string;
  source: string;
}

export interface SleepNight {
  date: string; // local date the member woke up
  startTs: number;
  endTs: number;
  totalMin: number;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const GAP = 3 * 3600_000; // segments closer than 3 h are one sleep
const MIN_SLEEP = 120; // shorter sessions are naps

export function sleepNights(segs: RawSleep[]): SleepNight[] {
  const bySource = new Map<string, RawSleep[]>();
  for (const s of segs) if (s.end > s.start) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);

  type Night = SleepNight & { detail: number };
  const nights = new Map<string, Night[]>();
  for (const list of bySource.values()) {
    list.sort((a, b) => a.start - b.start);
    let cur: RawSleep[] = [];
    let curEnd = 0;
    const flush = () => {
      const asleep = cur.filter((x) => x.state !== "inBed" && x.state !== "awake");
      const mins = (st: string[]) => Math.round(cur.filter((x) => st.includes(x.state)).reduce((a, x) => a + (x.end - x.start), 0) / 60_000);
      const total = mins(["asleep", "light", "deep", "rem"]);
      if (total >= MIN_SLEEP && asleep.length) {
        const start = Math.min(...asleep.map((x) => x.start));
        const end = Math.max(...asleep.map((x) => x.end));
        const deep = mins(["deep"]);
        const rem = mins(["rem"]);
        const light = mins(["light"]);
        const detail = deep + rem + light;
        const night: Night = {
          date: localDate(new Date(end)),
          startTs: start,
          endTs: end,
          // Staged sources sometimes also write a generic "asleep" span; don't count the night twice.
          totalMin: detail ? Math.min(total, Math.round((end - start) / 60_000)) : total,
          deepMin: detail ? deep : null,
          remMin: detail ? rem : null,
          lightMin: detail ? light : null,
          awakeMin: mins(["awake"]) || null,
          detail,
        };
        nights.set(night.date, [...(nights.get(night.date) ?? []), night]);
      }
      cur = [];
      curEnd = 0;
    };
    for (const s of list) {
      if (cur.length && s.start - curEnd > GAP) flush();
      cur.push(s);
      curEnd = Math.max(curEnd, s.end);
    }
    if (cur.length) flush();
  }
  return [...nights.values()].map((ns) => {
    // Prefer staged data (a watch) over an unstaged phone estimate; then the longest sleep.
    const best = ns.sort((a, b) => Number(b.detail > 0) - Number(a.detail > 0) || b.totalMin - a.totalMin)[0];
    const { detail: _detail, ...night } = best;
    void _detail;
    return night;
  });
}
