# AEVUM for Amazfit Bip 6 (Zepp OS)

A Zepp OS mini-app that reads health data stored on the watch and syncs it to AEVUM through the Zepp phone app.

| Part | Runs on | Does |
| --- | --- | --- |
| `page/home` | watch | reads sensors (`shared/collect.js`), shows status, *Sync* button; syncs on open |
| `app-side` | phone (inside Zepp) | claims the pairing code, stores the device token, POSTs to `/api/device/ingest/zepp` |
| `setting` | phone (Zepp › AEVUM › Settings) | pairing-code input, connection status, server override |

Data sent: today's steps, calories, distance, resting HR, PAI; heart rate as 5-minute averages; hourly stress (and daily stress for the previous 6 days); SpO₂ for the last 24 h; last night's sleep with stages. The Bip 6 does not expose HRV to mini-apps, so AEVUM does not show HRV for this device.

## Before building

1. Create a developer account at the Zepp Open Platform (https://console.zepp.com) and register the app. Put the **appId** you receive into `app.json` (the `1000001` there is a placeholder).
2. Set `DEFAULT_SERVER` in `shared/config.js` to your production URL (HTTPS).
3. Confirm the Bip 6's API level in Zepp's device list. This app targets **API level 3.0** and uses only 3.0-level sensor APIs (`getResting`, `getLastFewHour`, `getTodayByHour`, `getLastWeek`).

## Build and test

```bash
npm i -g @zeppos/zeus-cli
cd wearables/zepp-bip6 && npm install
zeus dev       # simulator
zeus preview   # QR code: install on your own Bip 6 via Zepp app › Profile › Developer mode
zeus build     # .zab package to submit in the Zepp console
```

The payload format is covered by `tests/zepp-contract.test.ts` in the main project, which runs `collect()` against mocked sensors and validates the output with the server's ingest schema. It has not yet been run on a physical Bip 6; do that before submitting to the store: check sleep times around midnight and that every sensor returns data on current firmware.

## Distribution

Members install from the Zepp App Store after Zepp's review. Until it is approved, test devices can install through `zeus preview`.
