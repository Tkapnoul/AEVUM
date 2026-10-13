# AEVUM

Member app for a longevity / preventive-health membership. Each member:

- sees their own health data (AEVUM Score, sleep, resting heart rate, stress, SpO₂, steps, PAI, weight, lab results),
- books and joins **1-1 video sessions** with their coaches, doctors, nutritionists and physiotherapists, and messages them,
- connects their **Amazfit Bip 6** so data syncs automatically (more devices later),
- talks to **AEVUM AI**, a built-in assistant (Claude) that reads their data through tools and helps them act on it,
- installs it on their phone as an app (PWA: home-screen icon, full screen, offline shell).

Experts (coach / doctor / nutritionist / physio) log in to the same app and get a portal: today's sessions, their members' data, session notes, lab entry (doctors), messages and weekly availability.

Greek and English UI; Greek is the default.

> **Company content:** the brand-specific parts (plans, pillars, goals, copy) live in [`shared/company.ts`](shared/company.ts). The company site could not be read from the build environment, so those values are a neutral baseline and need to be aligned with the real offering.

## Stack

| Part | Tech |
| --- | --- |
| App (PWA) | React 19, React Router, Tailwind CSS 4, Recharts, vite-plugin-pwa (Workbox) |
| API | Hono on Node ≥ 22.13, `node:sqlite` (no native deps), zod, JWT cookie sessions |
| AI | Anthropic SDK, `claude-opus-5-5`, streaming + tool use, server-side refusal fallback |
| Watch | Zepp OS mini-app (API level 3.0+) in [`wearables/zepp-bip6`](wearables/zepp-bip6) |

## Run it

```bash
npm install
cp .env.example .env          # set JWT_SECRET; add ANTHROPIC_API_KEY to enable AI
npm run seed                  # demo care team + a demo member with 60 days of synthetic data
npm run dev                   # API on :8787, app on http://localhost:5173
```

Demo logins (password `aevum-demo-2026`): `demo@aevum.test` (member), `coach@aevum.test`, `doctor@aevum.test`, `nutrition@aevum.test`, `physio@aevum.test`.
Demo data is generated, stored with source `demo`, and must never be seeded in production (the script refuses when `NODE_ENV=production`).

```bash
npm test          # API, booking, pairing/ingest, AI tool loop (mock API), watch payload contract
npm run typecheck
npm run build && npm start    # production: one Node process serves the API and the built app
```

## Deploying

Any host that runs a long-lived Node process with a persistent disk works (Fly.io, Render, Railway, a VPS). Requirements:

- **HTTPS** — required for PWA install, secure cookies, and for the watch's phone-side service to reach the API.
- `NODE_ENV=production`, `JWT_SECRET`, `PUBLIC_URL`, `DATABASE_PATH` on the persistent volume, `ANTHROPIC_API_KEY`.
- `VIDEO_BASE_URL`: `meet.jit.si` is fine for testing, but for production use your own Jitsi server or JaaS (8x8) so rooms, recording policy and data residency are under your control. Calls open in a new tab.
- SQLite is right for one instance. Moving to Postgres later only touches `server/db.ts` and the SQL in the routes.

## How it fits together

```
Amazfit Bip 6 ──BLE──▶ Zepp app (phone) ──HTTPS──▶ AEVUM API ◀── AEVUM PWA (member / expert)
  watch page reads      side service adds the        /api/device/ingest/zepp          │
  on-device sensors     device token                                                  ▼
                                                                              Claude (AEVUM AI)
```

- **Pairing:** the member taps *Profile › Devices › Amazfit Bip 6 › Create code* (6 characters, 15 min, single use) and types it into the AEVUM settings page inside the Zepp app. The phone-side service exchanges it for a device token (stored hashed on the server). Re-pairing or *Disconnect* revokes the old token.
- **Sync:** opening AEVUM on the watch reads today's steps, calories, distance, resting HR, PAI, 5-minute heart rate, hourly stress, SpO₂ and last night's sleep (with stages), and sends them through the phone. Uploads are idempotent (upserts keyed by user, metric, timestamp and source).
- **AEVUM Score:** 0–100, last 7 days vs the member's own 30-day baseline across sleep, recovery (resting HR), movement (steps) and stress. Shown only with ≥ 2 signals and ≥ 3 days of data. It is a coaching index, not a diagnosis.
- **AI:** each conversation starts with a frozen snapshot of the member (profile, goals, 7/30-day averages, care team, upcoming sessions). Claude fetches detail through read-only tools (`get_metric_history`, `get_sleep_history`, `get_lab_results`, `find_session_slots`, `list_sessions`). The system prompt forbids diagnosis and medication advice, sends emergencies to 112, and points members to their care team. History is stored and replayed append-only; a new conversation starts after 6 h idle or 80 turns. The daily insight on *Today* is generated once per member per day.
- **Access control:** members see only their own data; experts see a member's data only when they are on that member's care team or have a booking with them; only doctors (and the member) can add lab results; messaging is open only between linked member–expert pairs.
- **Privacy:** data export (JSON) and account deletion are in *Profile*. Offline-cached data is wiped on logout.

## Adding more watches

`devices.kind` and the ingest payload are device-agnostic. The realistic next step is a **Capacitor** wrapper of this PWA so it can read **Apple HealthKit** and **Android Health Connect**: almost every watch (Garmin, Fitbit, Samsung, Oura, and Zepp itself) writes to one of those. That adds every major watch through one integration instead of one per vendor. Direct vendor APIs (Garmin Health API, Oura API, Withings) are the alternative where a cloud sync is preferred.

## Project layout

```
server/            API (routes/, ai/, lib/), SQLite schema in db.ts, seed.ts
src/               PWA: pages/ (member), pages/expert/, components/, lib/ (api, i18n, session)
shared/            types and metric catalogue shared by API and app; company.ts (brand/business config)
wearables/zepp-bip6/  Zepp OS mini-app for the Bip 6
tests/             vitest suites
```
