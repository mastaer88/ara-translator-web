/**
 * 경로 고도 (Open-Meteo Elevation API, 무료·키 없음). 한 번에 100개 좌표까지.
 * 경로를 약 50m 간격으로 뽑아 조회하고 나머지 점은 거리 비율로 보간한다.
 */
import type { LatLng } from "./geo";

const MAX_SAMPLES = 300;

export async function fetchElevations(coords: LatLng[], cum: number[]): Promise<number[]> {
  if (coords.length < 2) return coords.map(() => 0);
  const total = cum[cum.length - 1];
  const step = Math.max(50, total / MAX_SAMPLES);
  const idx: number[] = [0];
  for (let i = 1; i < coords.length - 1; i++) if (cum[i] - cum[idx[idx.length - 1]] >= step) idx.push(i);
  idx.push(coords.length - 1);

  const sampled: number[] = [];
  for (let s = 0; s < idx.length; s += 100) {
    const part = idx.slice(s, s + 100);
    const params = new URLSearchParams({
      latitude: part.map((i) => coords[i].lat.toFixed(5)).join(","),
      longitude: part.map((i) => coords[i].lng.toFixed(5)).join(","),
    });
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?${params}`);
    if (!res.ok) throw new Error(`고도 HTTP ${res.status}`);
    const data = (await res.json()) as { elevation: number[] };
    sampled.push(...data.elevation);
  }

  // 조회한 점 사이는 거리 비율로 보간
  const out = new Array<number>(coords.length);
  for (let k = 0; k < idx.length - 1; k++) {
    const [a, b] = [idx[k], idx[k + 1]];
    const span = cum[b] - cum[a] || 1;
    for (let i = a; i <= b; i++)
      out[i] = sampled[k] + ((cum[i] - cum[a]) / span) * (sampled[k + 1] - sampled[k]);
  }
  return out;
}
