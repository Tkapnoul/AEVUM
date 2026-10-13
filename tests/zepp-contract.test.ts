import { describe, expect, it, vi } from "vitest";

vi.mock("@zos/sensor", () => import("./mocks/zos-sensor"));

const { ZeppPayload } = await import("../server/routes/devices");
// @ts-expect-error plain JS module from the watch app
const { collect } = await import("../wearables/zepp-bip6/shared/collect.js");
const { fake } = await import("./mocks/zos-sensor");

describe("Bip 6 watch payload", () => {
  it("is accepted by the ingest schema", () => {
    fake.hrMinutes = Array.from({ length: 600 }, (_, i) => (i % 7 === 0 ? 0 : 60 + (i % 20)));
    const payload = collect();
    const parsed = ZeppPayload.safeParse(payload);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("buckets heart rate into 5-minute averages and drops invalid readings", () => {
    fake.hrMinutes = [0, 0, 0, 0, 0, 70, 72, 74, 255, 0];
    const p = collect();
    expect(p.heartRate).toHaveLength(1);
    expect(p.heartRate[0].bpm).toBe(72);
  });

  it("places a sleep that started before midnight on the previous evening", () => {
    const p = collect();
    expect(p.sleep.endTs - p.sleep.startTs).toBe((7 * 60 + 40) * 60_000) // 23:10 → 06:50;
    expect(p.sleep.deepMin).toBe(84);
    expect(p.sleep.stages.find((s: { stage: string }) => s.stage === "light").end).toBeLessThan(p.sleep.endTs);
  });

  it("skips invalid SpO2 and empty stress hours", () => {
    const p = collect();
    expect(p.spo2.map((s: { value: number }) => s.value)).toEqual([97, 96]);
    expect(p.stress.every((s: { value: number }) => s.value > 0)).toBe(true);
    expect(p.daily.filter((d: { stressAvg?: number }) => d.stressAvg != null)).toHaveLength(5); // the zero day is skipped
  });
});
