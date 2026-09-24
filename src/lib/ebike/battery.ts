/**
 * 전기자전거 배터리 잔량·주행 가능 거리 추정.
 * 사용자가 배터리 %를 입력한 시점의 누적 거리를 기준으로, 이후 달린 거리 × 소모량(Wh/km)을 빼서 계산한다.
 * 다음에 %를 다시 입력하면 실제 소모량을 계산해 학습한다.
 */
export type BatteryState = {
  /** 배터리 용량 (Wh) = 전압(V) × 용량(Ah) */
  capacityWh: number;
  /** 1km당 소모량 (Wh/km) */
  whPerKm: number;
  /** 소모량 학습에 반영된 횟수 */
  learned: number;
  /** 마지막으로 입력한 배터리 % */
  percent: number | null;
  /** % 입력 당시 누적 주행 거리 (m) */
  odometerAt: number;
  setAt: number | null;
};

const KEY = "ebike-battery-v1";

export const DEFAULT_BATTERY: BatteryState = {
  capacityWh: 360,
  whPerKm: 10,
  learned: 0,
  percent: null,
  odometerAt: 0,
  setAt: null,
};

export function loadBattery(): BatteryState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_BATTERY, ...JSON.parse(raw) };
  } catch {
    // 무시
  }
  return DEFAULT_BATTERY;
}

export function saveBattery(b: BatteryState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // 무시
  }
}

/** 지금 배터리 %와 주행 가능 거리 (km) 추정 */
export function estimateBattery(b: BatteryState, odometer: number): { percent: number; rangeKm: number } | null {
  if (b.percent === null) return null;
  const usedWh = (Math.max(0, odometer - b.odometerAt) / 1000) * b.whPerKm;
  const percent = Math.max(0, b.percent - (usedWh / b.capacityWh) * 100);
  return { percent, rangeKm: ((percent / 100) * b.capacityWh) / b.whPerKm };
}

/** 새 배터리 %를 입력: 3km 이상 달린 뒤라면 실제 소모량을 학습 */
export function recordPercent(b: BatteryState, percent: number, odometer: number): BatteryState {
  let { whPerKm, learned } = b;
  const km = (odometer - b.odometerAt) / 1000;
  if (b.percent !== null && km >= 3 && percent < b.percent) {
    const measured = (((b.percent - percent) / 100) * b.capacityWh) / km;
    if (measured >= 2 && measured <= 50) {
      // 처음엔 측정값을 많이, 여러 번 반영될수록 천천히 조정
      const w = learned === 0 ? 0.7 : 0.3;
      whPerKm = Math.round((whPerKm * (1 - w) + measured * w) * 10) / 10;
      learned += 1;
    }
  }
  return { ...b, percent, odometerAt: odometer, setAt: Date.now(), whPerKm, learned };
}
