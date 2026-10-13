// Minimal stand-in for the Zepp OS sensor module so the watch collector can run under Node.
const H = 3600_000;
export const fake = {
  hrMinutes: [] as number[],
};
export class Step { getCurrent() { return 8421; } }
export class Calorie { getCurrent() { return 412; } }
export class Distance { getCurrent() { return 6120; } }
export class Pai { getTotal() { return 74; } }
export class HeartRate {
  getToday() { return fake.hrMinutes; }
  getResting() { return 58; }
}
export class BloodOxygen {
  getLastFewHour() {
    const now = Math.floor(Date.now() / 1000);
    return [{ spo2: 97, time: now - 7200 }, { spo2: 0, time: now - 3600 }, { spo2: 96, time: now - 60 }];
  }
}
export class Stress {
  getLastWeek() { return [30, 0, 35, 40, 28, 33, 31]; }
  getTodayByHour() { return Array.from({ length: 24 }, (_, h) => (h < 8 ? 0 : 20 + h)); }
}
export class Sleep {
  updateInfo() {}
  // 23:10 yesterday → 06:50 today, in minutes relative to today's 00:00 as the firmware reports it.
  getInfo() { return { score: 81, deepTime: 84, startTime: 23 * 60 + 10, endTime: 6 * 60 + 50, totalTime: 440 }; }
  getStageConstantObj() { return { WAKE_STAGE: 7, REM_STAGE: 8, LIGHT_STAGE: 4, DEEP_STAGE: 5 }; }
  getStage() {
    return [
      { model: 4, start: 23 * 60 + 10, stop: 24 * 60 + 30 },
      { model: 5, start: 30, stop: 114 },
      { model: 8, start: 114, stop: 200 },
      { model: 7, start: 200, stop: 210 },
    ];
  }
}
void H;
