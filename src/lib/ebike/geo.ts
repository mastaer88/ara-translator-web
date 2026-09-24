export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** 두 좌표 사이의 거리 (m) */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a → b 방위각 (0~360°, 북쪽 0) */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 경로 좌표의 누적 거리 배열 */
export function cumulativeDistances(coords: LatLng[]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  }
  return cum;
}

export type RouteProjection = {
  /** 가장 가까운 구간의 시작 인덱스 */
  index: number;
  /** 출발점부터 투영점까지의 경로상 거리 (m) */
  distAlong: number;
  /** 현재 위치와 경로 사이의 거리 (m) */
  distFromRoute: number;
};

/** 현재 위치를 경로(폴리라인) 위에 투영 */
export function projectOnRoute(p: LatLng, coords: LatLng[], cum: number[]): RouteProjection {
  let best: RouteProjection = { index: 0, distAlong: 0, distFromRoute: Infinity };
  const cosLat = Math.cos(toRad(p.lat));
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    // 현재 위치 기준 평면 근사 (수 km 이내에서 충분히 정확)
    const ax = (a.lng - p.lng) * mPerDegLng;
    const ay = (a.lat - p.lat) * mPerDegLat;
    const bx = (b.lng - p.lng) * mPerDegLng;
    const by = (b.lat - p.lat) * mPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best.distFromRoute) {
      best = {
        index: i,
        distAlong: cum[i] + t * (cum[i + 1] - cum[i]),
        distFromRoute: d,
      };
    }
  }
  if (coords.length === 1) {
    best = { index: 0, distAlong: 0, distFromRoute: haversine(p, coords[0]) };
  }
  return best;
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return "-";
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}km`;
  return `${Math.max(0, Math.round(m / 10) * 10)}m`;
}

/** 음성 안내용 거리 표현 */
export function spokenDistance(m: number): string {
  if (m >= 1000) {
    const km = Math.round(m / 100) / 10;
    return `${km}킬로미터`;
  }
  const rounded = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
  return `${rounded}미터`;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "-";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatEta(sec: number): string {
  if (!Number.isFinite(sec)) return "-";
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}
