/**
 * 카카오맵 길찾기(자전거·도보) 응답 해석 (서버 전용)
 * 응답: route.properties{totalDistance, totalTime, landingUrl} → legs[] → steps[]{properties{guidance, distance, x, y}, path{points}}
 */
type Step = { x: number; y: number; guidance: string; distance: number };

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);

/** 한국 좌표 범위로 [경도, 위도] 순서를 판별 (응답이 [y, x]로 오는 경우 대비) */
function toLngLat(a: number, b: number): [number, number] {
  const aIsLat = a > 30 && a < 45 && b > 120 && b < 135;
  return aIsLat ? [b, a] : [a, b];
}

/** 응답 구조가 문서와 조금 달라도 읽을 수 있게 방어적으로 해석 */
export function parseKakaoRoute(data: unknown) {
  const d = data as Record<string, unknown>;
  if (typeof d?.status === "string" && d.status !== "OK") throw new Error(`카카오 길찾기 상태: ${d.status}`);
  const root = (d?.route ?? (Array.isArray(d?.routes) ? d.routes[0] : undefined) ?? d) as Record<
    string,
    unknown
  >;
  const props = (root?.properties ?? root?.summary ?? {}) as Record<string, unknown>;
  const legs = (Array.isArray(root?.legs) ? root.legs : []) as Record<string, unknown>[];

  const coords: [number, number][] = [];
  const steps: Step[] = [];
  const push = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const [lng, lat] = toLngLat(x, y);
    const last = coords[coords.length - 1];
    if (!last || last[0] !== lng || last[1] !== lat) coords.push([lng, lat]);
  };

  for (const leg of legs) {
    for (const step of (Array.isArray(leg.steps) ? leg.steps : []) as Record<string, unknown>[]) {
      const sp = (step.properties ?? step) as Record<string, unknown>;
      const path = step.path as Record<string, unknown> | unknown[] | undefined;
      const points = (Array.isArray(path) ? path : (path?.points ?? step.points ?? [])) as unknown[];
      for (const p of points) {
        if (Array.isArray(p)) push(n(p[0]), n(p[1]));
        else if (p && typeof p === "object")
          push(n((p as Record<string, unknown>).x), n((p as Record<string, unknown>).y));
      }
      const [sx, sy] = toLngLat(n(sp.x), n(sp.y));
      if (Number.isFinite(sx) && Number.isFinite(sy)) {
        steps.push({ x: sx, y: sy, guidance: String(sp.guidance ?? ""), distance: n(sp.distance) || 0 });
        if (points.length === 0) push(sx, sy);
      }
    }
  }
  if (coords.length < 2) throw new Error("카카오 길찾기 결과에 경로가 없습니다");
  return {
    coords,
    distance: n(props.totalDistance ?? props.distance) || 0,
    duration: n(props.totalTime ?? props.duration) || 0,
    steps,
    landingUrl: typeof props.landingUrl === "string" ? props.landingUrl : null,
  };
}
