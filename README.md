# AEVUM

Health and longevity app for a small group (you and your friends). Each member:

- sees their own data: AEVUM Score, sleep, resting HR, HRV, VO₂max, SpO₂, steps, blood pressure, glucose, weight, lab results,
- gets an **AI biological age** (overall and per body system) and **PhenoAge** from blood tests,
- connects **any watch or ring** (via Apple Health / Health Connect, plus a direct Amazfit Bip 6 app),
- books and joins **1-1 video sessions** with whoever in the group is coach / doctor / nutritionist / physio, and messages them,
- chats with **AEVUM AI** (Claude), which reads their data through tools,
- runs as a real phone app: native Android/iOS (Capacitor) or an installable PWA.

Greek and English UI. **Greek step-by-step setup guide: [docs/odigos.md](docs/odigos.md).**

## Getting data in, for every watch

| Phone | Best option | What it covers |
| --- | --- | --- |
| Android | **AEVUM Android app** (APK built by GitHub Actions) → Health Connect | Samsung, Pixel/Fitbit, Garmin, Amazfit/Zepp, Oura, Whoop, Withings, Polar, Coros, Xiaomi… anything that writes to Health Connect |
| iPhone | **AEVUM iOS app** (build in Xcode on a Mac) → Apple Health | Apple Watch and every watch whose app writes to Apple Health |
| iPhone, no Mac | **Health Auto Export** app → `/api/device/ingest/hae` (automatic, hourly) | everything in Apple Health |
| iPhone, nothing installed | **Apple Health export.zip** import (in the app, processed on the phone) | last 12 months, one-off / occasional |
| Amazfit Bip 6 | Zepp OS mini-app in [`wearables/zepp-bip6`](wearables/zepp-bip6), or Zepp → Apple Health / Health Connect | Bip 6 |
| Anything else | JSON API with a token ([docs/api-ingest.md](docs/api-ingest.md)) | iOS Shortcuts, Tasker, scripts |

The native app syncs every time it is opened (at most every 30 min) and on demand; the first sync pulls 90 days.
Huawei watches are the main gap: Huawei Health does not write to Health Connect.

## Biological age

- **PhenoAge** (Levine et al., 2018): computed exactly from age + 9 blood markers (albumin, creatinine, glucose, CRP, lymphocyte %, MCV, RDW, ALP, WBC), converted from whatever units the lab used. Shown when all 9 are available from draws ≤ 4 months apart.
- **AI report**: Claude (`claude-opus-5-5`, effort high, schema-validated structured output) estimates an equivalent age for seven systems (cardiorespiratory fitness, cardiovascular, metabolic, body composition, sleep & recovery, blood & inflammation, activity) from 90 days of data against age/sex norms, weights them into an overall biological age with a confidence level, and lists drivers, 3–5 concrete recommendations and data gaps. PhenoAge is the anchor for the blood system. Runs in the background (1–2 min); history and pace of ageing are tracked.
- **Lab results from a photo/PDF**: the AI reads the report (Greek or English), maps tests to the catalogue, and the member reviews before saving.

It is an estimate for motivation and guidance, not a diagnosis; accuracy rises with VO₂max, HRV and recent blood work.

## Run it

```bash
npm install
cp .env.example .env     # set JWT_SECRET and ANTHROPIC_API_KEY
npm run dev              # API :8787, app http://localhost:5173
npm run seed             # optional: demo care team + demo member with synthetic data
```

The **first account registered becomes admin** (Profile → Manage users) and can make friends coaches, doctors, etc.; experts join every member's care team and get Mon–Fri 09–17 availability they can edit.

```bash
npm test && npm run typecheck
npm run build && npm start
```

## Deploy (needs HTTPS so phones can reach it)

- **VPS + Docker** (recommended): `docker compose up -d` with `DOMAIN`, `JWT_SECRET`, `ANTHROPIC_API_KEY` in `.env`; Caddy gets the certificate automatically.
- **Home computer**: run `npm start` and expose port 8787 with Tailscale Funnel (`tailscale funnel 8787`) or a Cloudflare Tunnel for a stable HTTPS address.
- SQLite file at `DATABASE_PATH`; back it up.
- `VIDEO_BASE_URL`: rooms open in the browser/Jitsi app. `meet.jit.si` works but may ask the first participant to sign in; a self-hosted Jitsi avoids that.

## Native apps

```bash
npm run build:web && npx cap sync      # copy the built app into android/ and ios/
```

- **Android**: GitHub Actions (`.github/workflows/android.yml`) builds `aevum.apk` on every push (Artifacts) and, when run manually with *publish*, as the `android-latest` release. Set the repository variable `AEVUM_SERVER_URL` to pre-fill the server address. For in-place updates add a signing key as secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`; create with `keytool -genkeypair -v -keystore aevum.jks -keyalg RSA -keysize 2048 -validity 10000 -alias aevum`).
- **iOS**: on a Mac with Xcode, `npx cap open ios`, choose your Team under *Signing & Capabilities* (a free Apple ID works for your own phone; apps signed that way expire after 7 days, a paid developer account lets you share via TestFlight). HealthKit entitlement and usage texts are already set.

## Stack

React 19 + Tailwind 4 + Recharts (PWA via vite-plugin-pwa) · Capacitor 8 + `@capgo/capacitor-health` · Hono on Node ≥ 22.13 with `node:sqlite` · Anthropic SDK (streaming chat with tools, structured outputs, server-side refusal fallback) · Zepp OS mini-app.

```
server/   API: routes/, ai/ (chat, bio age, prompts, tools), lib/ (ingest, HAE parser, PhenoAge, score, slots)
src/      app: pages/, components/, lib/ (healthSync, appleExport, sleepNights, native, i18n)
shared/   metric + lab catalogues, company config
android/ ios/  Capacitor projects
wearables/zepp-bip6/  Zepp OS mini-app
tests/    vitest (API, parsers, PhenoAge, AI flows against a mock API)
```
