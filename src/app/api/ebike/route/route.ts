import { NextResponse } from "next/server";
import { parseKakaoRoute } from "@/lib/ebike/kakaoRoute";

/**
 * 카카오맵 길찾기 프록시 (자전거 / 도보)
 * GET ?mode=bicycle|walk&from=lat,lng&to=lat,lng
 * → { coords: [lng, lat][], distance(m), duration(s), steps: {x, y, guidance, distance}[], landingUrl }
 * KAKAO_REST_API_KEY 가 없으면 503 → 앱은 BRouter/OSRM으로 대체
 */

const KEY = process.env.KAKAO_REST_API_KEY;

function parseLatLng(v: string | null): { lat: number; lng: number } | null {
  const [lat, lng] = (v ?? "").split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}

export async function GET(req: Request) {
  if (!KEY) return NextResponse.json({ error: "카카오 키가 설정되지 않았습니다" }, { status: 503 });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "walk" ? "walk" : "bicycle";
  const from = parseLatLng(url.searchParams.get("from"));
  const to = parseLatLng(url.searchParams.get("to"));
  if (!from || !to) return NextResponse.json({ error: "출발지·목적지 좌표가 필요합니다" }, { status: 400 });

  const params = new URLSearchParams({
    start_x: String(from.lng),
    start_y: String(from.lat),
    end_x: String(to.lng),
    end_y: String(to.lat),
  });
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/routing/${mode}?${params}`, {
      headers: { Authorization: `KakaoAK ${KEY}` },
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("kakao routing error", res.status, data);
      return NextResponse.json({ error: `카카오 길찾기 오류 (${res.status})` }, { status: 502 });
    }
    return NextResponse.json(parseKakaoRoute(data));
  } catch (err) {
    console.error("kakao routing error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "카카오 길찾기 오류" },
      { status: 502 },
    );
  }
}
