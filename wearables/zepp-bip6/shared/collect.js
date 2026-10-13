// Reads everything the AEVUM backend accepts from the watch's on-device health store.
// Runs on the watch. All sensor calls are wrapped: a sensor that is missing on a
// firmware or not yet populated must not break the whole sync.
import { Step, Calorie, Distance, HeartRate, BloodOxygen, Stress, Sleep, Pai } from '@zos/sensor'

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN

function safe(fn, fallback) {
  try {
    const v = fn()
    return v === undefined ? fallback : v
  } catch (e) {
    return fallback
  }
}

const pad = (n) => (n < 10 ? '0' + n : '' + n)
// Local calendar date of the watch, which is what the member thinks of as "today".
const localDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

function localMidnight(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Minute-level heart rate for today, averaged into 5-minute buckets. */
function heartRateToday(midnight) {
  const minutes = safe(() => new HeartRate().getToday(), [])
  const out = []
  for (let i = 0; i < minutes.length; i += 5) {
    let sum = 0
    let n = 0
    for (let j = i; j < i + 5 && j < minutes.length; j++) {
      const v = minutes[j]
      if (v >= 25 && v <= 250) {
        sum += v
        n++
      }
    }
    if (n) out.push({ ts: midnight + i * MIN, bpm: Math.round(sum / n) })
  }
  return out
}

function sleepLastNight(now, midnight) {
  const sleep = safe(() => new Sleep(), null)
  if (!sleep) return null
  safe(() => sleep.updateInfo(), null)
  const info = safe(() => sleep.getInfo(), null)
  if (!info || !info.totalTime) return null

  // Times are minutes relative to 00:00 today; a start "after" the end means it began yesterday evening.
  const toTs = (m) => midnight + m * MIN
  let startTs = toTs(info.startTime)
  const endTs = toTs(info.endTime)
  if (startTs > endTs) startTs -= DAY

  const c = safe(() => sleep.getStageConstantObj(), null)
  const stages = safe(() => sleep.getStage(), []) || []
  const totals = { wake: 0, light: 0, deep: 0, rem: 0 }
  const out = []
  if (c) {
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i]
      const stage =
        s.model === c.DEEP_STAGE ? 'deep' : s.model === c.REM_STAGE ? 'rem' : s.model === c.LIGHT_STAGE ? 'light' : s.model === c.WAKE_STAGE ? 'wake' : null
      if (!stage) continue
      let a = toTs(s.start)
      let b = toTs(s.stop)
      if (a > endTs) a -= DAY
      if (b > endTs) b -= DAY
      if (b <= a) continue
      totals[stage] += Math.round((b - a) / MIN)
      out.push({ stage, start: a, end: b })
    }
  }
  return {
    date: localDate(new Date(now)),
    startTs,
    endTs,
    totalMin: info.totalTime,
    deepMin: info.deepTime != null ? info.deepTime : totals.deep || null,
    lightMin: totals.light || null,
    remMin: totals.rem || null,
    awakeMin: totals.wake || null,
    score: info.score || null,
    stages: out.slice(0, 200),
  }
}

export function collect() {
  const now = Date.now()
  const today = new Date(now)
  const midnight = localMidnight(now)

  const hr = safe(() => new HeartRate(), null)
  const daily = [
    {
      date: localDate(today),
      steps: safe(() => new Step().getCurrent(), undefined),
      calories: safe(() => new Calorie().getCurrent(), undefined),
      distance: safe(() => new Distance().getCurrent(), undefined),
      restingHr: hr ? safe(() => hr.getResting(), undefined) || undefined : undefined,
      pai: safe(() => new Pai().getTotal(), undefined),
    },
  ]

  // Daily stress averages for the previous six days (index 6 is today).
  const stress = safe(() => new Stress(), null)
  const week = stress ? safe(() => stress.getLastWeek(), []) : []
  for (let i = 0; i < 6 && i < week.length; i++) {
    if (!week[i]) continue
    const d = new Date(midnight - (6 - i) * DAY)
    daily.push({ date: localDate(d), stressAvg: week[i] })
  }

  // Hourly stress for today (0 = no reading).
  const stressSamples = []
  const byHour = stress ? safe(() => stress.getTodayByHour(), []) : []
  for (let h = 0; h < byHour.length; h++) {
    if (byHour[h] > 0) stressSamples.push({ ts: midnight + h * 60 * MIN + 30 * MIN, value: byHour[h] })
  }

  const spo2 = []
  const ox = safe(() => new BloodOxygen().getLastFewHour(24), []) || []
  for (let i = 0; i < ox.length; i++) {
    if (ox[i].spo2 >= 50 && ox[i].spo2 <= 100) spo2.push({ ts: ox[i].time * 1000, value: ox[i].spo2 })
  }

  return {
    capturedAt: now,
    daily,
    heartRate: heartRateToday(midnight),
    spo2,
    stress: stressSamples,
    sleep: sleepLastNight(now, midnight),
  }
}
