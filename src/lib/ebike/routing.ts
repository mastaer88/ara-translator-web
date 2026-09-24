import { cumulativeDistances, haversine, projectOnRoute, type LatLng } from "./geo";

/**
 * 경로 탐색 프로필 (BRouter 기준)
 * - safety: 자전거도로·차량 적은 길 최우선
 * - trekking: 자전거도로 선호 + 거리 균형
 * - fastbike: 빠른 도로 위주 (차도 포함)
 */
export type RouteProfile = "safety" | "trekking" | "fastbike";

export const PROFILE_LABELS: Record<RouteProfile, { name: string; desc: string }> = {
  safety: { name: "자전거도로 우선", desc: "자전거 전용·겸용도로를 최대한 이용" },
  trekking: { name: "균형", desc: "자전거도로 선호 + 거리 고려" },
  fastbike: { name: "빠른 길", desc: "최단 시간 위주, 차도 포함" },
};

export type TurnType =
  | "straight"
  | "left"
  | "slight-left"
  | "sharp-left"
  | "right"
  | "slight-right"
  | "sharp-right"
  | "keep-left"
  | "keep-right"
  | "uturn"
  | "roundabout"
  | "arrive";

export type Maneuver = {
  /** 출발점부터의 경로상 거리 (m) */
  distAlong: number;
  type: TurnType;
  /** 화면/음성 안내 문구 (예: "좌회전") */
  text: string;
  location: LatLng;
};

export type Route = {
  coords: LatLng[];
  cum: number[];
  distance: number;
  /** 자전거 전용/겸용 도로 비율 (0~1), 알 수 없으면 null */
  cyclewayRatio: number | null;
  maneuvers: Maneuver[];
  source: "brouter" | "osrm";
  profile: RouteProfile;
};

export type Place = { name: string; detail: string; location: LatLng };

const TURN_TEXT: Record<TurnType, string> = {
  straight: "직진",
  left: "좌회전",
  "slight-left": "왼쪽 방향",
  "sharp-left": "급좌회전",
  right: "우회전",
  "slight-right": "오른쪽 방향",
  "sharp-right": "급우회전",
  "keep-left": "왼쪽 길 유지",
  "keep-right": "오른쪽 길 유지",
  uturn: "유턴",
  roundabout: "회전교차로",
  arrive: "목적지 도착",
};

function turnText(type: TurnType, exit?: number): string {
  if (type === "roundabout" && exit && exit > 0) return `회전교차로 ${exit}번째 출구`;
  return TURN_TEXT[type];
}

async function fetchJson(url: string, signal?: AbortSignal, timeoutMs = 20000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ───────────────────────── 장소 검색 (OpenStreetMap Nominatim) ─────────────────────────

type NominatimItem = { lat: string; lon: string; display_name: string; name?: string };

export async function searchPlaces(query: string, near?: LatLng | null): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "8",
    "accept-language": "ko",
  });
  if (near) {
    // 현재 위치 주변 결과를 우선 (범위 밖 결과도 허용)
    const d = 0.3;
    params.set("viewbox", `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
  }
  const data = (await fetchJson(
    `https://nominatim.openstreetmap.org/search?${params}`,
  )) as NominatimItem[];
  return data.map((item) => {
    const parts = item.display_name.split(",").map((s) => s.trim());
    return {
      name: item.name || parts[0],
      detail: parts.slice(1, 4).join(", "),
      location: { lat: parseFloat(item.lat), lng: parseFloat(item.lon) },
    };
  });
}

export async function reverseGeocode(p: LatLng): Promise<string> {
  try {
    const params = new URLSearchParams({
      lat: String(p.lat),
      lon: String(p.lng),
      format: "jsonv2",
      zoom: "17",
      "accept-language": "ko",
    });
    const data = (await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
    )) as NominatimItem;
    return data.name || data.display_name.split(",")[0] || "선택한 위치";
  } catch {
    return "선택한 위치";
  }
}

// ───────────────────────── 경로 탐색: BRouter (자전거 특화) ─────────────────────────

// BRouter voicehint 명령 번호 → 회전 종류
const BROUTER_CMD: Record<number, TurnType> = {
  1: "straight",
  2: "left",
  3: "slight-left",
  4: "sharp-left",
  5: "right",
  6: "slight-right",
  7: "sharp-right",
  8: "keep-left",
  9: "keep-right",
  10: "uturn",
  11: "uturn",
  12: "uturn",
  14: "roundabout",
  15: "roundabout",
  17: "keep-left",
  18: "keep-right",
};

type BRouterGeoJson = {
  features: {
    geometry: { coordinates: number[][] };
    properties: {
      "track-length"?: string;
      messages?: string[][];
      voicehints?: number[][];
    };
  }[];
};

const CYCLE_TAG = /highway=cycleway|bicycle=designated|cycleway(:\w+)?=(lane|track|shared_lane)|route_bicycle_/;

function cyclewayRatioFromMessages(messages?: string[][]): number | null {
  if (!messages || messages.length < 2) return null;
  const header = messages[0];
  const distIdx = header.indexOf("Distance");
  const tagIdx = header.indexOf("WayTags");
  if (distIdx < 0 || tagIdx < 0) return null;
  let total = 0;
  let cycle = 0;
  for (const row of messages.slice(1)) {
    const d = parseFloat(row[distIdx]) || 0;
    total += d;
    if (CYCLE_TAG.test(row[tagIdx] ?? "")) cycle += d;
  }
  return total > 0 ? cycle / total : null;
}

async function routeWithBRouter(from: LatLng, to: LatLng, profile: RouteProfile): Promise<Route> {
  const params = new URLSearchParams({
    lonlats: `${from.lng},${from.lat}|${to.lng},${to.lat}`,
    profile,
    alternativeidx: "0",
    format: "geojson",
    timode: "3",
  });
  const data = (await fetchJson(`https://brouter.de/brouter?${params}`)) as BRouterGeoJson;
  const feature = data.features?.[0];
  if (!feature) throw new Error("경로를 찾지 못했습니다");

  const coords = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const cum = cumulativeDistances(coords);
  const maneuvers: Maneuver[] = [];
  for (const hint of feature.properties.voicehints ?? []) {
    const [index, cmd, exit] = hint;
    const type = BROUTER_CMD[cmd];
    if (!type || type === "straight" || index >= coords.length) continue;
    maneuvers.push({
      distAlong: cum[index],
      type,
      text: turnText(type, exit),
      location: coords[index],
    });
  }
  return finalizeRoute({
    coords,
    cum,
    distance: cum[cum.length - 1] ?? 0,
    cyclewayRatio: cyclewayRatioFromMessages(feature.properties.messages),
    maneuvers,
    source: "brouter",
    profile,
  });
}

// ───────────────────────── 예비 경로 탐색: OSRM 자전거 프로필 ─────────────────────────

type OsrmResponse = {
  code: string;
  routes: {
    distance: number;
    geometry: { coordinates: number[][] };
    legs: {
      steps: {
        maneuver: { type: string; modifier?: string; location: number[]; exit?: number };
      }[];
    }[];
  }[];
};

function osrmTurn(type: string, modifier?: string): TurnType | null {
  if (type === "depart" || type === "arrive") return null;
  if (type.includes("roundabout") || type === "rotary") return "roundabout";
  switch (modifier) {
    case "left":
      return type === "fork" ? "keep-left" : "left";
    case "right":
      return type === "fork" ? "keep-right" : "right";
    case "slight left":
      return "slight-left";
    case "slight right":
      return "slight-right";
    case "sharp left":
      return "sharp-left";
    case "sharp right":
      return "sharp-right";
    case "uturn":
      return "uturn";
    default:
      return null;
  }
}

async function routeWithOsrm(from: LatLng, to: LatLng, profile: RouteProfile): Promise<Route> {
  const url =
    `https://routing.openstreetmap.de/routed-bike/route/v1/bike/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const data = (await fetchJson(url)) as OsrmResponse;
  const r = data.routes?.[0];
  if (data.code !== "Ok" || !r) throw new Error("경로를 찾지 못했습니다");

  const coords = r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const cum = cumulativeDistances(coords);
  const maneuvers: Maneuver[] = [];
  for (const step of r.legs.flatMap((l) => l.steps)) {
    const type = osrmTurn(step.maneuver.type, step.maneuver.modifier);
    if (!type) continue;
    const location = { lat: step.maneuver.location[1], lng: step.maneuver.location[0] };
    maneuvers.push({
      distAlong: projectOnRoute(location, coords, cum).distAlong,
      type,
      text: turnText(type, step.maneuver.exit),
      location,
    });
  }
  return finalizeRoute({
    coords,
    cum,
    distance: cum[cum.length - 1] ?? r.distance,
    cyclewayRatio: null,
    maneuvers,
    source: "osrm",
    profile,
  });
}

function finalizeRoute(route: Route): Route {
  const end = route.coords[route.coords.length - 1];
  // 너무 가까이 붙은 안내(10m 이내)는 하나로 합침
  const merged: Maneuver[] = [];
  for (const m of route.maneuvers.sort((a, b) => a.distAlong - b.distAlong)) {
    const prev = merged[merged.length - 1];
    if (prev && m.distAlong - prev.distAlong < 10) continue;
    merged.push(m);
  }
  merged.push({ distAlong: route.distance, type: "arrive", text: TURN_TEXT.arrive, location: end });
  return { ...route, maneuvers: merged };
}

/** 자전거 경로 탐색. BRouter 실패 시 OSRM 자전거 프로필로 대체 */
export async function findBikeRoute(from: LatLng, to: LatLng, profile: RouteProfile): Promise<Route> {
  if (haversine(from, to) < 20) throw new Error("출발지와 목적지가 너무 가깝습니다");
  try {
    return await routeWithBRouter(from, to, profile);
  } catch (err) {
    console.warn("BRouter 실패, OSRM으로 재시도", err);
    return await routeWithOsrm(from, to, profile);
  }
}
