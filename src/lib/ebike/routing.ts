import { cumulativeDistances, haversine, projectOnRoute, type LatLng } from "./geo";

/**
 * 경로 탐색 프로필 (BRouter 기준)
 * - safety: 자전거도로·차량 적은 길 최우선
 * - trekking: 자전거도로 선호 + 거리 균형
 * - fastbike: 빠른 도로 위주 (차도 포함)
 */
export type RouteProfile = "safety" | "trekking" | "fastbike" | "kakao" | "battery";

export const PROFILE_LABELS: Record<RouteProfile, { name: string; desc: string }> = {
  safety: { name: "자전거도로 우선", desc: "자전거 전용·겸용도로를 최대한 이용" },
  trekking: { name: "균형", desc: "자전거도로 선호 + 거리 고려" },
  fastbike: { name: "빠른 길", desc: "최단 시간 위주, 차도 포함" },
  kakao: { name: "카카오 자전거", desc: "카카오맵 자전거 길찾기 · 한국어 안내 문구 (카카오 키 필요)" },
  battery: {
    name: "🔋 배터리 절약",
    desc: "여러 경로의 오르막·거리·바람을 계산해 배터리를 가장 적게 쓰는 길",
  },
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
  | "via"
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
  source: "brouter" | "osrm" | "kakao";
  profile: RouteProfile;
  /** 걷기 경로 (주차 위치로 걸어가기 등) */
  walk?: boolean;
  /** 카카오맵 앱·웹에서 같은 경로 보기 */
  landingUrl?: string | null;
  /** 요청한 방식 대신 다른 방식으로 찾은 경우 안내 */
  note?: string;
  /** 각 좌표의 고도 (m) — 배터리 계산용 */
  elev?: number[];
  /** 경로 비교 화면에 보일 이름 */
  label?: string;
  /** 배터리 절약 후보를 만든 BRouter 방식 (경로 이탈 시 이 방식으로 빠르게 재탐색) */
  baseProfile?: RouteProfile;
  /** 경유지 (이름과 출발점부터의 경로상 거리) */
  via?: { name: string; distAlong: number }[];
};

export type Place = { name: string; detail: string; location: LatLng; distance?: number | null };

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
  via: "경유지",
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

// ───────────── 카카오 로컬 (서버에 키가 있을 때) → 없으면 OpenStreetMap ─────────────

/** 카카오 사용 가능 여부 (503을 한 번 받으면 이후 바로 OpenStreetMap 사용) */
let kakaoAvailable: boolean | null = null;

async function kakaoPlace<T>(params: Record<string, string>): Promise<T | null> {
  if (kakaoAvailable === false) return null;
  try {
    const res = await fetch(`/api/ebike/place?${new URLSearchParams(params)}`);
    if (res.status === 503) {
      kakaoAvailable = false;
      return null;
    }
    if (!res.ok) return null;
    kakaoAvailable = true;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function searchPlaces(query: string, near?: LatLng | null): Promise<Place[]> {
  const kakao = await kakaoPlace<{
    places: { name: string; detail: string; lat: number; lng: number; distance: number | null }[];
  }>({ q: query, ...(near ? { lat: String(near.lat), lng: String(near.lng) } : {}) });
  if (kakao) {
    return kakao.places.map((p) => ({
      name: p.name,
      detail: p.detail,
      location: { lat: p.lat, lng: p.lng },
      distance: p.distance,
    }));
  }
  return searchNominatim(query, near);
}

async function searchNominatim(query: string, near?: LatLng | null): Promise<Place[]> {
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
  const data = (await fetchJson(`https://nominatim.openstreetmap.org/search?${params}`)) as NominatimItem[];
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
  const kakao = await kakaoPlace<{ name: string | null }>({
    lat: String(p.lat),
    lng: String(p.lng),
    reverse: "1",
  });
  if (kakao?.name) return kakao.name;
  try {
    const params = new URLSearchParams({
      lat: String(p.lat),
      lon: String(p.lng),
      format: "jsonv2",
      zoom: "17",
      "accept-language": "ko",
    });
    const data = (await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`)) as NominatimItem;
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

const CYCLE_TAG =
  /highway=cycleway|bicycle=designated|cycleway(:\w+)?=(lane|track|shared_lane)|route_bicycle_/;

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

async function routeWithBRouter(
  from: LatLng,
  to: LatLng,
  profile: RouteProfile,
  alternative = 0,
  via: LatLng[] = [],
): Promise<Route> {
  const brouterProfile = profile === "kakao" || profile === "battery" ? "safety" : profile;
  const params = new URLSearchParams({
    lonlats: [from, ...via, to].map((p) => `${p.lng},${p.lat}`).join("|"),
    profile: brouterProfile,
    alternativeidx: String(alternative),
    format: "geojson",
    timode: "3",
  });
  const data = (await fetchJson(`https://brouter.de/brouter?${params}`)) as BRouterGeoJson;
  const feature = data.features?.[0];
  if (!feature) throw new Error("경로를 찾지 못했습니다");

  const coords = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  // BRouter 좌표의 세 번째 값은 고도
  const hasElev = feature.geometry.coordinates.every((c) => typeof c[2] === "number");
  const elev = hasElev ? feature.geometry.coordinates.map((c) => c[2]) : undefined;
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
    elev,
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

async function routeWithOsrm(
  from: LatLng,
  to: LatLng,
  profile: RouteProfile,
  walk = false,
  via: LatLng[] = [],
): Promise<Route> {
  const url =
    (walk
      ? `https://routing.openstreetmap.de/routed-foot/route/v1/foot/`
      : `https://routing.openstreetmap.de/routed-bike/route/v1/bike/`) +
    [from, ...via, to].map((p) => `${p.lng},${p.lat}`).join(";") +
    `?overview=full&geometries=geojson&steps=true`;
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
    walk,
  });
}

// ───────────────────────── 카카오맵 길찾기 (자전거·도보) ─────────────────────────

type KakaoRouteResponse = {
  coords: [number, number][];
  distance: number;
  duration: number;
  steps: { x: number; y: number; guidance: string; distance: number }[];
  landingUrl: string | null;
};

/** 카카오 안내 문구 → 회전 종류 (회전·횡단 안내가 아니면 null) */
export function guidanceToTurn(text: string): TurnType | null {
  if (/도착/.test(text)) return null;
  if (/유턴/.test(text)) return "uturn";
  if (/회전교차로/.test(text)) return "roundabout";
  if (/급\s*좌/.test(text)) return "sharp-left";
  if (/급\s*우/.test(text)) return "sharp-right";
  if (/좌회전/.test(text)) return "left";
  if (/우회전/.test(text)) return "right";
  if (/(왼쪽|좌측)/.test(text)) return "slight-left";
  if (/(오른쪽|우측)/.test(text)) return "slight-right";
  if (/(횡단보도|육교|지하도|계단)/.test(text)) return "straight";
  return null;
}

async function routeWithKakao(
  from: LatLng,
  to: LatLng,
  profile: RouteProfile,
  walk: boolean,
): Promise<Route> {
  const params = new URLSearchParams({
    mode: walk ? "walk" : "bicycle",
    from: `${from.lat},${from.lng}`,
    to: `${to.lat},${to.lng}`,
  });
  const res = await fetch(`/api/ebike/route?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `카카오 길찾기 오류 (${res.status})`);
  const r = data as KakaoRouteResponse;

  const coords = r.coords.map(([lng, lat]) => ({ lat, lng }));
  const cum = cumulativeDistances(coords);
  const maneuvers: Maneuver[] = [];
  for (const step of r.steps) {
    const type = guidanceToTurn(step.guidance);
    if (!type) continue;
    const location = { lat: step.y, lng: step.x };
    maneuvers.push({
      distAlong: projectOnRoute(location, coords, cum).distAlong,
      type,
      // 카카오 문구가 너무 길면 기본 문구 사용
      text: step.guidance.length <= 30 ? step.guidance : turnText(type),
      location,
    });
  }
  return finalizeRoute({
    coords,
    cum,
    distance: cum[cum.length - 1] ?? r.distance,
    cyclewayRatio: null,
    maneuvers,
    source: "kakao",
    profile,
    walk,
    landingUrl: r.landingUrl,
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

/**
 * 자전거 경로 탐색.
 * - "카카오 자전거": 카카오맵 → 실패하면 BRouter(자전거도로 우선)
 * - 나머지: BRouter → 실패하면 OSRM 자전거
 */
export async function findBikeRoute(
  from: LatLng,
  to: LatLng,
  profile: RouteProfile,
  via: LatLng[] = [],
): Promise<Route> {
  if (haversine(from, to) < 20 && via.length === 0) throw new Error("출발지와 목적지가 너무 가깝습니다");
  if (profile === "kakao") {
    try {
      return await routeWithKakaoVia(from, to, profile, via);
    } catch (err) {
      console.warn("카카오 자전거 길찾기 실패, BRouter로 대체", err);
      const r = await routeWithBRouter(from, to, "safety", 0, via).catch(() =>
        routeWithOsrm(from, to, profile, false, via),
      );
      return { ...r, profile, note: "카카오 길찾기를 쓸 수 없어 자전거도로 우선 경로로 찾았습니다" };
    }
  }
  try {
    return await routeWithBRouter(from, to, profile, 0, via);
  } catch (err) {
    console.warn("BRouter 실패, OSRM으로 재시도", err);
    return await routeWithOsrm(from, to, profile, false, via);
  }
}

/** 카카오 길찾기는 출발·도착만 받으므로 경유지가 있으면 구간별로 찾아 이어 붙임 */
async function routeWithKakaoVia(
  from: LatLng,
  to: LatLng,
  profile: RouteProfile,
  via: LatLng[],
): Promise<Route> {
  if (via.length === 0) return routeWithKakao(from, to, profile, false);
  const stops = [from, ...via, to];
  const parts: Route[] = [];
  for (let i = 0; i < stops.length - 1; i++)
    parts.push(await routeWithKakao(stops[i], stops[i + 1], profile, false));
  return mergeRoutes(parts);
}

/** 여러 구간 경로를 하나로 합침 (구간 끝의 "도착" 안내는 빼고 마지막에 하나만) */
function mergeRoutes(parts: Route[]): Route {
  const coords: LatLng[] = [];
  const elev: number[] = [];
  const maneuvers: Maneuver[] = [];
  let offset = 0;
  for (const part of parts) {
    const skip = coords.length > 0 ? 1 : 0; // 이어지는 첫 점은 앞 구간의 끝점과 같음
    coords.push(...part.coords.slice(skip));
    if (part.elev) elev.push(...part.elev.slice(skip));
    for (const m of part.maneuvers) {
      if (m.type !== "arrive") maneuvers.push({ ...m, distAlong: m.distAlong + offset });
    }
    offset += part.distance;
  }
  const cum = cumulativeDistances(coords);
  return finalizeRoute({
    ...parts[0],
    coords,
    cum,
    distance: cum[cum.length - 1] ?? 0,
    maneuvers,
    elev: elev.length === coords.length ? elev : undefined,
    landingUrl: null,
  });
}

/** 경로에 경유지 안내(📍)를 넣음. 경유지는 순서대로 경로 위에 투영 */
export function annotateVia(route: Route, via: { name: string; location: LatLng }[]): Route {
  if (via.length === 0) return route;
  let fromIdx = 0;
  const marks: { name: string; distAlong: number }[] = [];
  const maneuvers = [...route.maneuvers];
  for (const v of via) {
    const proj = projectOnRoute(v.location, route.coords.slice(fromIdx), route.cum.slice(fromIdx));
    const idx = fromIdx + proj.index;
    const distAlong = proj.distAlong; // 잘라낸 cum도 출발점 기준 거리 그대로
    fromIdx = idx;
    marks.push({ name: v.name, distAlong });
    maneuvers.push({ distAlong, type: "via", text: `경유지 ${v.name}`, location: v.location });
  }
  maneuvers.sort((a, b) => a.distAlong - b.distAlong);
  return { ...route, maneuvers, via: marks };
}

/** 고도가 없는 경로(카카오·OSRM)는 Open-Meteo 고도로 채움. 실패하면 고도 없이 (평지로 계산) */
export async function ensureElevation(route: Route): Promise<Route> {
  if (route.elev && route.elev.length === route.coords.length) return route;
  try {
    const { fetchElevations } = await import("./elevation");
    return { ...route, elev: await fetchElevations(route.coords, route.cum) };
  } catch (err) {
    console.warn("고도 조회 실패", err);
    return route;
  }
}

/**
 * 배터리 절약 경로 후보: BRouter 자전거도로 우선·균형·빠른 길 + 자전거도로 우선의 대안 경로.
 * 비슷한 경로는 하나로 합치고, 모두 고도를 채워서 돌려준다.
 */
export async function findBatteryCandidates(from: LatLng, to: LatLng, via: LatLng[] = []): Promise<Route[]> {
  if (haversine(from, to) < 20 && via.length === 0) throw new Error("출발지와 목적지가 너무 가깝습니다");
  const tries: [RouteProfile, number, string][] = [
    ["safety", 0, "자전거도로 우선"],
    ["trekking", 0, "균형"],
    ["fastbike", 0, "빠른 길"],
    ["safety", 1, "다른 길"],
  ];
  const results = await Promise.allSettled(
    tries.map(([p, alt, label]) =>
      routeWithBRouter(from, to, p, alt, via).then((r) => ({ ...r, label, baseProfile: p })),
    ),
  );
  let routes: Route[] = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (routes.length === 0)
    routes = [{ ...(await routeWithOsrm(from, to, "battery", false, via)), label: "기본 경로" }];

  // 거리 1% · 좌표가 거의 같은 경로는 중복으로 보고 제거
  const unique: Route[] = [];
  for (const r of routes) {
    const dup = unique.some(
      (u) =>
        Math.abs(u.distance - r.distance) / Math.max(u.distance, 1) < 0.01 &&
        u.coords.length > 2 &&
        haversine(u.coords[Math.floor(u.coords.length / 2)], r.coords[Math.floor(r.coords.length / 2)]) < 50,
    );
    if (!dup) unique.push({ ...r, profile: "battery" });
  }
  return Promise.all(unique.map(ensureElevation));
}

/** 걷기 경로 (주차 위치로 걸어가기): 카카오 도보 → 실패하면 OSRM 도보 */
export async function findWalkRoute(from: LatLng, to: LatLng): Promise<Route> {
  if (haversine(from, to) < 15) throw new Error("이미 가까이 있습니다");
  try {
    return await routeWithKakao(from, to, "kakao", true);
  } catch (err) {
    console.warn("카카오 도보 길찾기 실패, OSRM 도보로 대체", err);
    return await routeWithOsrm(from, to, "kakao", true);
  }
}

// ───────────────────────── 주변 찾기 (카카오 카테고리·키워드) ─────────────────────────

export type NearbyKind = { id: string; icon: string; label: string; category?: string; keyword?: string };

export const NEARBY_KINDS: NearbyKind[] = [
  { id: "CS2", icon: "🏪", label: "편의점", category: "CS2" },
  { id: "toilet", icon: "🚻", label: "화장실", keyword: "공중화장실" },
  { id: "repair", icon: "🔧", label: "자전거 수리", keyword: "자전거 수리" },
  { id: "CE7", icon: "☕", label: "카페", category: "CE7" },
  { id: "FD6", icon: "🍚", label: "음식점", category: "FD6" },
  { id: "SW8", icon: "🚇", label: "지하철역", category: "SW8" },
  { id: "PM9", icon: "💊", label: "약국", category: "PM9" },
  { id: "HP8", icon: "🏥", label: "병원", category: "HP8" },
];

/** 주변 장소 (가까운 순). 카카오 키가 없으면 null */
export async function searchNearby(kind: NearbyKind, near: LatLng): Promise<Place[] | null> {
  const params: Record<string, string> = { lat: String(near.lat), lng: String(near.lng) };
  if (kind.category) params.category = kind.category;
  else {
    params.q = kind.keyword ?? kind.label;
    params.nearby = "1";
  }
  const data = await kakaoPlace<{
    places: { name: string; detail: string; lat: number; lng: number; distance: number | null }[];
  }>(params);
  if (!data) return null;
  return data.places.map((p) => ({
    name: p.name,
    detail: p.detail,
    location: { lat: p.lat, lng: p.lng },
    distance: p.distance,
  }));
}

/** 카카오 기능(검색·길찾기)을 쓸 수 있는지 (한 번이라도 503을 받았으면 false) */
export const kakaoEnabled = () => kakaoAvailable !== false;

/** 좌표의 전체 주소 (위치 정보 조회용) */
export async function addressOf(p: LatLng): Promise<string | null> {
  const kakao = await kakaoPlace<{ address: string | null }>({
    lat: String(p.lat),
    lng: String(p.lng),
    reverse: "1",
  });
  if (kakao?.address) return kakao.address;
  try {
    const params = new URLSearchParams({
      lat: String(p.lat),
      lon: String(p.lng),
      format: "jsonv2",
      zoom: "18",
      "accept-language": "ko",
    });
    const data = (await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`)) as NominatimItem;
    // Nominatim은 "번지, 도로, 동, 구, 시, 우편번호, 국가" 순서 → 한국식으로 뒤집음
    const parts = data.display_name
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "대한민국" && !/^\d{5}$/.test(s));
    return parts.reverse().join(" ");
  } catch {
    return null;
  }
}
