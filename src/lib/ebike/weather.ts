/**
 * 날씨·바람 (Open-Meteo, 무료·키 없음)
 */
import type { LatLng } from "./geo";

export type Weather = {
  tempC: number;
  code: number;
  windMs: number;
  gustMs: number;
  /** 바람이 불어오는 방향 (°, 북=0) */
  windFromDeg: number;
  /** 앞으로 3시간 최대 강수 확률 (%) */
  rainChance: number;
  precipitationMm: number;
  fetchedAt: number;
};

export async function fetchWeather(p: LatLng): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: p.lat.toFixed(3),
    longitude: p.lng.toFixed(3),
    current: "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "precipitation_probability",
    forecast_hours: "3",
    wind_speed_unit: "ms",
    timezone: "auto",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`날씨 HTTP ${res.status}`);
  const data = await res.json();
  const c = data.current;
  const probs: number[] = data.hourly?.precipitation_probability ?? [];
  return {
    tempC: c.temperature_2m,
    code: c.weather_code,
    windMs: c.wind_speed_10m,
    gustMs: c.wind_gusts_10m,
    windFromDeg: c.wind_direction_10m,
    rainChance: probs.length ? Math.max(...probs.filter((x) => typeof x === "number")) : 0,
    precipitationMm: c.precipitation ?? 0,
    fetchedAt: Date.now(),
  };
}

/** WMO 날씨 코드 → 아이콘·설명 */
export function describeWeather(code: number): { icon: string; text: string } {
  if (code === 0) return { icon: "☀️", text: "맑음" };
  if (code <= 2) return { icon: "🌤", text: "구름 조금" };
  if (code === 3) return { icon: "☁️", text: "흐림" };
  if (code === 45 || code === 48) return { icon: "🌫", text: "안개" };
  if (code >= 51 && code <= 57) return { icon: "🌦", text: "이슬비" };
  if (code >= 61 && code <= 67) return { icon: "🌧", text: "비" };
  if (code >= 71 && code <= 77) return { icon: "🌨", text: "눈" };
  if (code >= 80 && code <= 82) return { icon: "🌧", text: "소나기" };
  if (code >= 85 && code <= 86) return { icon: "🌨", text: "눈 소나기" };
  if (code >= 95) return { icon: "⛈", text: "뇌우" };
  return { icon: "🌡", text: "" };
}

const DIRS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
export const windName = (fromDeg: number) => `${DIRS[Math.round(fromDeg / 45) % 8]}풍`;

/**
 * 진행 방향 기준 바람: 양수 = 맞바람(m/s), 음수 = 뒷바람
 * @param travelDeg 가는 방향 (°)
 */
export function headwind(w: Weather, travelDeg: number): number {
  return w.windMs * Math.cos(((w.windFromDeg - travelDeg) * Math.PI) / 180);
}

export function windEffectText(hw: number, windMs: number): string {
  if (windMs < 2) return "바람 약함";
  if (hw >= 2) return `맞바람 ${hw.toFixed(1)}m/s — 평소보다 느리고 배터리를 더 씁니다`;
  if (hw <= -2) return `뒷바람 ${(-hw).toFixed(1)}m/s — 평소보다 수월합니다`;
  return `옆바람 ${windMs.toFixed(1)}m/s — 다리 위·강변에서 주의`;
}
