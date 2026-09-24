import type { RouteProfile } from "@/lib/ebike/routing";

export type PeriodicMode = "off" | "time" | "distance";

export type EbikeSettings = {
  voiceEnabled: boolean;
  voiceURI: string | null;
  rate: number;
  volume: number;
  /** 속도 초과 경고 사용 */
  speedWarn: boolean;
  /** 속도 제한 (km/h) — 국내 PAS 전기자전거 법정 최고속도 25km/h */
  speedLimit: number;
  /** 주기적 속도 안내 */
  periodicMode: PeriodicMode;
  periodicMinutes: number;
  periodicKm: number;
  /** 길 안내 음성 */
  navVoice: boolean;
  /** 도착 예정 시간 계산용 평균 주행 속도 (km/h) */
  cruiseSpeed: number;
  profile: RouteProfile;
  cycleLayer: boolean;
  keepAwake: boolean;
};

export const DEFAULT_SETTINGS: EbikeSettings = {
  voiceEnabled: true,
  voiceURI: null,
  rate: 1,
  volume: 1,
  speedWarn: true,
  speedLimit: 25,
  periodicMode: "time",
  periodicMinutes: 5,
  periodicKm: 1,
  navVoice: true,
  cruiseSpeed: 20,
  profile: "safety",
  cycleLayer: true,
  keepAwake: true,
};

const KEY = "ebike-settings-v1";

export function loadSettings(): EbikeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // 저장소 접근 불가 시 기본값 사용
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: EbikeSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 무시
  }
}
