import { NextResponse } from "next/server";

/**
 * 카카오 로컬 API 프록시 (키를 브라우저에 노출하지 않음)
 * - GET ?q=검색어&lat=&lng=   : 장소·주소 검색
 * - GET ?lat=&lng=&reverse=1  : 좌표 → 주소
 * KAKAO_REST_API_KEY 가 없으면 503 → 앱은 OpenStreetMap 검색으로 대체
 */

const KEY = process.env.KAKAO_REST_API_KEY;
const BASE = "https://dapi.kakao.com/v2/local";

type KakaoPlace = {
  place_name: string;
  address_name: string;
  road_address_name: string;
  category_name: string;
  x: string;
  y: string;
  distance?: string;
};
type KakaoAddress = {
  address_name: string;
  x: string;
  y: string;
  road_address: { address_name: string; building_name: string } | null;
};
type KakaoCoord2Address = {
  road_address: { address_name: string; building_name: string } | null;
  address: { address_name: string; region_3depth_name: string } | null;
};

async function kakao<T>(path: string, params: Record<string, string>): Promise<{ documents: T[] }> {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `KakaoAK ${KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Kakao HTTP ${res.status}`);
  return res.json();
}

const num = (v: string | null) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : null);

export async function GET(req: Request) {
  if (!KEY) return NextResponse.json({ error: "카카오 키가 설정되지 않았습니다" }, { status: 503 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const lat = num(url.searchParams.get("lat"));
  const lng = num(url.searchParams.get("lng"));

  try {
    if (url.searchParams.get("reverse")) {
      if (lat === null || lng === null) return NextResponse.json({ error: "좌표가 필요합니다" }, { status: 400 });
      const { documents } = await kakao<KakaoCoord2Address>("/geo/coord2address.json", {
        x: String(lng),
        y: String(lat),
      });
      const d = documents[0];
      if (!d) return NextResponse.json({ name: null, address: null });
      const road = d.road_address;
      return NextResponse.json({
        name: road?.building_name || road?.address_name.split(" ").slice(-2).join(" ") || d.address?.region_3depth_name || null,
        address: road ? `${road.address_name}${d.address ? ` (지번 ${d.address.address_name})` : ""}` : d.address?.address_name ?? null,
      });
    }

    if (!q) return NextResponse.json({ places: [] });
    const near = lat !== null && lng !== null ? { x: String(lng), y: String(lat) } : {};

    // 1) 장소 이름 검색 (가게·건물·공원 등)
    const keyword = await kakao<KakaoPlace>("/search/keyword.json", { query: q, size: "10", ...near });
    let places = keyword.documents.map((p) => ({
      name: p.place_name,
      detail: [p.road_address_name || p.address_name, p.category_name.split(" > ").pop()].filter(Boolean).join(" · "),
      lat: Number(p.y),
      lng: Number(p.x),
      distance: p.distance ? Number(p.distance) : null,
    }));

    // 2) 결과가 없으면 주소 검색 (도로명·지번)
    if (places.length === 0) {
      const addr = await kakao<KakaoAddress>("/search/address.json", { query: q, size: "10" });
      places = addr.documents.map((a) => ({
        name: a.road_address?.building_name || a.road_address?.address_name || a.address_name,
        detail: a.road_address ? a.address_name : "",
        lat: Number(a.y),
        lng: Number(a.x),
        distance: null,
      }));
    }
    return NextResponse.json({ places });
  } catch (err) {
    console.error("kakao local error", err);
    return NextResponse.json({ error: "카카오 검색 오류" }, { status: 502 });
  }
}
