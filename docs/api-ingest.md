# Sending data to AEVUM from anything (Shortcuts, Tasker, scripts)

Create a token in the app: **Profile → Devices & sync → API → Create token**. Then:

```
POST https://<your-server>/api/device/ingest/generic
Authorization: Bearer aev_…
Content-Type: application/json
```

```json
{
  "metrics": [
    { "type": "steps", "ts": 1760313600000, "value": 9421 },
    { "type": "resting_hr", "ts": 1760313600000, "value": 57 },
    { "type": "hrv", "ts": 1760338800000, "value": 48 },
    { "type": "bp_systolic", "ts": 1760342400000, "value": 121 },
    { "type": "bp_diastolic", "ts": 1760342400000, "value": 79 }
  ],
  "sleep": [
    { "date": "2025-10-13", "startTs": 1760304000000, "endTs": 1760331600000, "totalMin": 430, "deepMin": 70, "remMin": 95, "lightMin": 265, "awakeMin": 20 }
  ]
}
```

- `ts` is epoch milliseconds. For **daily** metrics (steps, active_calories, distance, resting_hr, pai, exercise_minutes, sleep_*, weight, body_fat) use 00:00 UTC of the member's local date, e.g. `Date.parse("2025-10-13T00:00:00Z")`.
- Metric types and units: `steps`, `active_calories` (kcal), `distance` (m), `heart_rate` (bpm), `resting_hr` (bpm), `hrv` (ms), `vo2max` (ml/kg/min), `spo2` (%), `respiratory_rate` (/min), `stress` (0–100), `pai`, `weight` (kg), `body_fat` (%), `bp_systolic`/`bp_diastolic` (mmHg), `blood_glucose` (mg/dL), `exercise_minutes`.
- Values outside physiological ranges are dropped (reported as `dropped`). Re-sending the same `type` + `ts` overwrites, so sending "the last 7 days" every hour is safe.
- Response: `{ "ok": true, "stored": 5, "nights": 1, "dropped": 0 }`.

## Health Auto Export (iPhone)

The iOS app *Health Auto Export – JSON+CSV* can push Apple Health data on a schedule (premium feature). In the app: **Automations → + → REST API**:

| Setting | Value |
| --- | --- |
| URL | `https://<your-server>/api/device/ingest/hae` |
| Headers | `Authorization` = `Bearer <token>` (create the token under **Profile → Devices & sync → Health Auto Export**) |
| Export format | JSON |
| Aggregate data | on, **Day** |
| Date range | Last 7 days |
| Sync cadence | every hour |
| Health metrics | all (or at least: step count, active energy, walking + running distance, exercise time, heart rate, resting heart rate, HRV, VO2 max, blood oxygen, respiratory rate, weight, body fat, blood pressure, blood glucose, sleep analysis) |
