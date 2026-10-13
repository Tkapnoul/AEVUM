// Development seed: a fictional care team and one demo member with ~60 days of
// synthetic wearable data (source = "demo"). Never run against production.
import { config } from "./config.js";
import { get, run, tx } from "./db.js";
import { hashPassword } from "./auth.js";
import { newId } from "./lib/ids.js";
import { upsertMetrics, upsertSleep, type MetricInput } from "./lib/metrics-store.js";
import { DAY_MS, isoDate, startOfUtcDay } from "./lib/time.js";
import { openSlots } from "./lib/slots.js";
import { matchLabKey } from "../shared/labs.js";

if (config.isProd) throw new Error("Refusing to seed in production");

const PASSWORD = "aevum-demo-2026";

const EXPERTS = [
  { email: "coach@aevum.test", name: "Ελένη Παπαδάκη", role: "coach", title: "Health & Performance Coach", bio: "Habit-based coaching for sleep, movement and energy." },
  { email: "doctor@aevum.test", name: "Δρ. Νίκος Αλεξίου", role: "doctor", title: "Longevity Physician (MD)", bio: "Preventive medicine, cardiometabolic health and lab review." },
  { email: "nutrition@aevum.test", name: "Μαρία Κωνσταντίνου", role: "nutritionist", title: "Clinical Dietitian", bio: "Evidence-based nutrition for body composition and metabolic health." },
  { email: "physio@aevum.test", name: "Γιώργος Δημητρίου", role: "physio", title: "Physiotherapist", bio: "Mobility, injury prevention and return to training." },
] as const;

// Deterministic PRNG so the demo looks the same on every machine.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const noise = (amp: number) => (rand() - 0.5) * 2 * amp;

async function main() {
  const hash = await hashPassword(PASSWORD);
  const now = Date.now();

  const expertIds: Record<string, string> = {};
  for (const e of EXPERTS) {
    const existing = get<{ id: string }>("SELECT id FROM users WHERE email = ?", e.email);
    const id = existing?.id ?? newId("u");
    expertIds[e.role] = id;
    if (existing) continue;
    tx(() => {
      run(
        "INSERT INTO users (id, email, password_hash, name, role, locale, goals, created_at) VALUES (?, ?, ?, ?, ?, 'el', '[]', ?)",
        id, e.email, hash, e.name, e.role, now,
      );
      run("INSERT INTO expert_profiles (user_id, title, bio, session_minutes) VALUES (?, ?, ?, ?)", id, e.title, e.bio, e.role === "doctor" ? 30 : 45);
      // Mon–Fri 09:00–13:00 and 16:00–19:00 (clinic time zone)
      for (let wd = 1; wd <= 5; wd++) {
        run("INSERT INTO availability (expert_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)", id, wd, 9 * 60, 13 * 60);
        run("INSERT INTO availability (expert_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)", id, wd, 16 * 60, 19 * 60);
      }
    });
  }

  const memberEmail = "demo@aevum.test";
  if (get("SELECT 1 FROM users WHERE email = ?", memberEmail)) {
    console.log("Demo member already exists; skipping data generation.");
    return;
  }
  const memberId = newId("u");
  run(
    `INSERT INTO users (id, email, password_hash, name, role, locale, birth_date, sex, height_cm, goals, plan, consent_at, created_at)
     VALUES (?, ?, ?, 'Demo Μέλος', 'member', 'el', '1986-04-12', 'male', 178, '["sleep_better","longevity","stress_less"]', 'member', ?, ?)`,
    memberId, memberEmail, hash, now, now - 60 * DAY_MS,
  );
  for (const role of ["coach", "doctor"]) {
    run("INSERT INTO care_team (member_id, expert_id, is_primary, created_at) VALUES (?, ?, 1, ?)", memberId, expertIds[role], now);
  }

  // ~60 days of plausible data with a mid-period improvement in sleep and resting HR.
  const items: MetricInput[] = [];
  const today = startOfUtcDay(now);
  for (let d = 59; d >= 0; d--) {
    const day = today - d * DAY_MS;
    const progress = (59 - d) / 59; // 0 → 1
    const weekend = [0, 6].includes(new Date(day).getUTCDay());
    items.push({ type: "steps", ts: day, value: Math.round(6500 + progress * 2500 + (weekend ? 2000 : 0) + noise(1800)) });
    items.push({ type: "active_calories", ts: day, value: Math.round(380 + progress * 120 + noise(80)) });
    items.push({ type: "distance", ts: day, value: Math.round((6500 + progress * 2500) * 0.75 + noise(900)) });
    items.push({ type: "resting_hr", ts: day, value: Math.round(64 - progress * 4 + noise(2)) });
    items.push({ type: "pai", ts: day, value: Math.round(55 + progress * 40 + noise(10)) });
    items.push({ type: "hrv", ts: day + 4 * 3600_000, value: Math.round(38 + progress * 9 + noise(6)) });
    if (d % 7 === 0) items.push({ type: "vo2max", ts: day + 18 * 3600_000, value: Math.round((41 + progress * 3 + noise(0.8)) * 10) / 10 });
    for (let h = 0; h < 24; h++) {
      const t = day + h * 3600_000;
      const awake = h >= 7 && h <= 23;
      items.push({ type: "stress", ts: t, value: Math.max(5, Math.round((awake ? 42 - progress * 10 : 18) + (h >= 10 && h <= 17 && !weekend ? 12 : 0) + noise(10))) });
      if (h % 3 === 0) items.push({ type: "spo2", ts: t, value: Math.min(100, Math.round(96.5 + noise(1.5))) });
    }
    if (d <= 1) {
      // Intraday heart rate (5-minute averages) for today and yesterday only.
      for (let m = 0; m < 1440; m += 5) {
        const h = m / 60;
        const base = h < 7 ? 54 : h > 23 ? 58 : 72;
        const walk = h > 8 && h < 9 ? 30 : h > 18 && h < 19 ? 45 : 0;
        if (day + m * 60_000 <= now) items.push({ type: "heart_rate", ts: day + m * 60_000, value: Math.round(base + walk + noise(6)) });
      }
    }
    const total = Math.round(390 + progress * 50 + noise(35));
    const deep = Math.round(total * (0.16 + progress * 0.03) + noise(8));
    const rem = Math.round(total * 0.21 + noise(8));
    const awakeMin = Math.round(18 + noise(8));
    const startTs = day - Math.round((60 + noise(30)) * 60_000); // ~23:00 the evening before (UTC)
    upsertSleep(memberId, "demo", {
      date: isoDate(day),
      startTs,
      endTs: startTs + (total + awakeMin) * 60_000,
      totalMin: total,
      deepMin: deep,
      remMin: rem,
      lightMin: total - deep - rem,
      awakeMin,
      score: Math.round(68 + progress * 14 + noise(5)),
    });
  }
  for (let w = 8; w >= 0; w--) items.push({ type: "weight", ts: today - w * 7 * DAY_MS, value: Math.round((84.5 - (8 - w) * 0.35 + noise(0.3)) * 10) / 10 });
  upsertMetrics(memberId, "demo", items);
  run(
    "INSERT INTO devices (id, user_id, kind, name, token_hash, created_at, last_sync_at) VALUES (?, ?, 'amazfit_bip6', 'Amazfit Bip 6 (demo)', ?, ?, ?)",
    newId("dev"), memberId, `demo-${memberId}`, now - 30 * DAY_MS, now - 2 * 3600_000,
  );

  // Labs entered by the doctor.
  const labDate = today - 21 * DAY_MS;
  const labs: [string, number, string, number | null, number | null][] = [
    ["Λευκωματίνη", 4.6, "g/dL", 3.5, 5.2],
    ["Κρεατινίνη", 0.95, "mg/dL", 0.7, 1.3],
    ["Γλυκόζη", 92, "mg/dL", 70, 110],
    ["Λεμφοκύτταρα %", 32, "%", 20, 45],
    ["MCV", 89, "fL", 80, 98],
    ["RDW", 12.8, "%", 11.5, 14.5],
    ["ALP", 68, "U/L", 40, 129],
    ["WBC", 5.8, "10³/µL", 4, 10.5],
    ["HbA1c", 5.4, "%", 4.0, 5.6],
    ["LDL-C", 138, "mg/dL", null, 130],
    ["HDL-C", 52, "mg/dL", 40, null],
    ["Triglycerides", 110, "mg/dL", null, 150],
    ["hs-CRP", 1.4, "mg/L", null, 3.0],
    ["Vitamin D (25-OH)", 24, "ng/mL", 30, 100],
    ["Ferritin", 96, "ng/mL", 30, 400],
    ["TSH", 1.9, "mIU/L", 0.4, 4.0],
  ];
  for (const [marker, value, unit, lo, hi] of labs) {
    run(
      "INSERT INTO labs (id, user_id, marker, marker_key, value, unit, ref_low, ref_high, taken_at, entered_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')",
      newId("lab"), memberId, marker, matchLabKey(marker), value, unit, lo, hi, labDate, expertIds.doctor,
    );
  }

  // One past session with notes, one upcoming with each care-team expert.
  const past = newId("bk");
  run(
    "INSERT INTO bookings (id, member_id, expert_id, starts_at, ends_at, status, topic, room_url, created_at) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)",
    past, memberId, expertIds.doctor, labDate + 3 * DAY_MS + 10 * 3600_000, labDate + 3 * DAY_MS + 10.5 * 3600_000,
    "Lab review", `${config.videoBaseUrl}/aevum-demo-past`, labDate,
  );
  run(
    "INSERT INTO session_notes (id, booking_id, author_id, content, visible_to_member, created_at) VALUES (?, ?, ?, ?, 1, ?)",
    newId("note"), past, expertIds.doctor,
    "LDL slightly above target and vitamin D low. Plan: 8 weeks of nutrition changes with Maria, vitamin D per prescription, recheck labs in 3 months.",
    labDate + 3 * DAY_MS + 11 * 3600_000,
  );
  for (const role of ["coach", "doctor"]) {
    const slot = openSlots(expertIds[role], 7, now)[role === "coach" ? 2 : 5];
    if (!slot) continue;
    run(
      "INSERT INTO bookings (id, member_id, expert_id, starts_at, ends_at, status, topic, room_url, created_at) VALUES (?, ?, ?, ?, ?, 'booked', ?, ?, ?)",
      newId("bk"), memberId, expertIds[role], slot.startsAt, slot.endsAt, role === "coach" ? "Weekly check-in" : "Follow-up",
      `${config.videoBaseUrl}/aevum-demo-${role}`, now,
    );
  }
  run(
    "INSERT INTO messages (id, member_id, expert_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId("msg"), memberId, expertIds.coach, expertIds.coach,
    "Καλημέρα! Είδα ότι ο ύπνος σου βελτιώθηκε αυτή την εβδομάδα. Συνέχισε με το σταθερό ωράριο 👏",
    now - 5 * 3600_000,
  );

  console.log(`Seeded. Log in with ${memberEmail} / ${PASSWORD}`);
  console.log(`Experts: ${EXPERTS.map((e) => e.email).join(", ")} (same password)`);
}

await main();
