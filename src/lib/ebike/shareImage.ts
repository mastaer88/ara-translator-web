/**
 * 주행 요약 이미지 (1080×1350 PNG): 코스 지도 + 주요 기록.
 * 지도 타일(OpenStreetMap)을 캔버스에 그릴 수 없으면(CORS·오프라인) 배경 없이 코스만 그린다.
 */
import { formatDistance, formatDuration } from "./geo";
import type { RideRecord } from "./rideStore";

const W = 1080;
const H = 1350;
const MAP = { x: 40, y: 250, w: 1000, h: 700 };
const TILE = 256;

const lon2x = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function climbOf(ride: RideRecord): number | null {
  const alts = ride.points.map((p) => p[4]).filter((a): a is number => typeof a === "number");
  if (alts.length < ride.points.length * 0.5 || alts.length < 5) return null;
  let climb = 0;
  let base = alts[0];
  for (const a of alts) {
    if (a - base >= 2) {
      climb += a - base;
      base = a;
    } else if (a < base) base = a;
  }
  return climb;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function draw(ride: RideRecord, withTiles: boolean): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);

  // 머리글
  const d = new Date(ride.startedAt);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  ctx.fillStyle = "#34d399";
  ctx.font = `600 34px ${font}`;
  ctx.fillText("🚲⚡ E-Bike 주행 기록", 60, 90);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = `700 56px ${font}`;
  ctx.fillText(
    `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} (${days[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    60,
    170,
  );
  if (ride.startName && ride.endName) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = `400 32px ${font}`;
    ctx.fillText(`${ride.startName} → ${ride.endName}`, 60, 222);
  }

  // 지도 영역
  ctx.save();
  roundRect(ctx, MAP.x, MAP.y, MAP.w, MAP.h, 28);
  ctx.clip();
  ctx.fillStyle = "#111a2e";
  ctx.fillRect(MAP.x, MAP.y, MAP.w, MAP.h);

  const lats = ride.points.map((p) => p[0]);
  const lngs = ride.points.map((p) => p[1]);
  const [minLat, maxLat, minLng, maxLng] = [
    Math.min(...lats),
    Math.max(...lats),
    Math.min(...lngs),
    Math.max(...lngs),
  ];
  // 코스가 지도 영역(여백 포함)에 들어가는 가장 큰 확대 단계
  let z = 17;
  for (; z > 3; z--) {
    const w = lon2x(maxLng, z) - lon2x(minLng, z);
    const h = lat2y(minLat, z) - lat2y(maxLat, z);
    if (w <= MAP.w - 160 && h <= MAP.h - 160) break;
  }
  const cx = (lon2x(minLng, z) + lon2x(maxLng, z)) / 2;
  const cy = (lat2y(minLat, z) + lat2y(maxLat, z)) / 2;
  const ox = MAP.x + MAP.w / 2 - cx;
  const oy = MAP.y + MAP.h / 2 - cy;

  if (withTiles) {
    const [tx0, tx1] = [Math.floor((cx - MAP.w / 2) / TILE), Math.floor((cx + MAP.w / 2) / TILE)];
    const [ty0, ty1] = [Math.floor((cy - MAP.h / 2) / TILE), Math.floor((cy + MAP.h / 2) / TILE)];
    const jobs: Promise<void>[] = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        jobs.push(
          loadImage(`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`).then((img) => {
            ctx.drawImage(img, tx * TILE + ox, ty * TILE + oy, TILE, TILE);
          }),
        );
      }
    }
    await Promise.all(jobs);
    // 어두운 화면에 어울리게 지도를 살짝 어둡게
    ctx.fillStyle = "rgba(11, 18, 32, 0.35)";
    ctx.fillRect(MAP.x, MAP.y, MAP.w, MAP.h);
  }

  // 코스
  const pts = ride.points.map((p) => [lon2x(p[1], z) + ox, lat2y(p[0], z) + oy] as const);
  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  path();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 16;
  ctx.stroke();
  path();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 10;
  ctx.stroke();
  const dot = ([x, y]: readonly [number, number], color: string) => {
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  };
  dot(pts[0], "#16a34a");
  dot(pts[pts.length - 1], "#dc2626");
  ctx.restore();

  // 기록
  const avg = ride.movingTime > 0 ? (ride.distance / ride.movingTime) * 3.6 : 0;
  const climb = climbOf(ride);
  const stats: [string, string][] = [
    ["거리", formatDistance(ride.distance)],
    ["주행 시간", formatDuration(ride.movingTime)],
    ["평균 속도", `${avg.toFixed(1)}km/h`],
    ["최고 속도", `${ride.maxSpeed.toFixed(1)}km/h`],
  ];
  if (climb !== null) stats.push(["오르막", `${Math.round(climb)}m`]);
  const cols = stats.length > 4 ? 3 : 2;
  const cellW = (W - 120 - (cols - 1) * 20) / cols;
  stats.forEach(([label, value], i) => {
    const x = 60 + (i % cols) * (cellW + 20);
    const y = 990 + Math.floor(i / cols) * 150;
    roundRect(ctx, x, y, cellW, 130, 22);
    ctx.fillStyle = "#1c2537";
    ctx.fill();
    ctx.fillStyle = "#f1f5f9";
    ctx.font = `700 52px ${font}`;
    ctx.fillText(value, x + 28, y + 70);
    ctx.fillStyle = "#94a3b8";
    ctx.font = `400 28px ${font}`;
    ctx.fillText(label, x + 28, y + 110);
  });
  return canvas;
}

/** 요약 이미지 PNG 만들기 */
export async function renderRideImage(ride: RideRecord): Promise<Blob> {
  const toBlob = (c: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지를 만들지 못했습니다"))), "image/png"),
    );
  try {
    return await toBlob(await draw(ride, true));
  } catch {
    // 타일을 못 불러오거나 캔버스가 막히면 지도 배경 없이
    return toBlob(await draw(ride, false));
  }
}

/** 이미지 공유 (아이폰 공유 창), 안 되면 다운로드 */
export async function shareImage(filename: string, blob: Blob) {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "E-Bike 주행 기록" });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
