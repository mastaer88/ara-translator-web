/**
 * 여러 기기 동기화 (서버: /api/ebike/sync) 와 파일 백업·복원.
 */
import {
  loadDeletedRides,
  loadRestoredRides,
  loadParking,
  loadPlaces,
  saveDeletedRides,
  saveRestoredRides,
  saveParking,
  savePlaces,
  type ParkingData,
  type PlacesData,
} from "./places";
import { deleteRide, listRides, saveRide, type RideRecord } from "./rideStore";

type Meta = { places?: PlacesData; parking?: ParkingData; deleted?: string[] };

const CODE_KEY = "ebike-sync-code";
const SERVER_KEY = "ebike-sync-server";
const LAST_SYNC_KEY = "ebike-last-sync";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 제외

export function generateSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

/** 입력한 코드를 XXXX-XXXX-XXXX-XXXX 형식으로 정리 (잘못되면 null) */
export function normalizeSyncCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 16 || /[01IO]/.test(raw)) return null;
  return raw.match(/.{4}/g)!.join("-");
}

export function loadSyncCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

export function saveSyncCode(code: string | null) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    // 무시
  }
}

export function loadLastSync(): number | null {
  try {
    const v = localStorage.getItem(LAST_SYNC_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/** 기록을 저장할 서버 주소 (예: PC). 비어 있으면 지금 열린 사이트의 서버 */
export function loadSyncServer(): string {
  try {
    return localStorage.getItem(SERVER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveSyncServer(url: string) {
  try {
    if (url) localStorage.setItem(SERVER_KEY, url);
    else localStorage.removeItem(SERVER_KEY);
  } catch {
    // 무시
  }
}

/** "abc.ts.net" → "https://abc.ts.net", 끝의 "/" · "/ebike" 제거 */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "").replace(/\/ebike$/, "");
}

function endpoint(): string {
  const base = loadSyncServer();
  if (base.startsWith("http:") && location.protocol === "https:") {
    throw new Error("PC 서버 주소는 https:// 로 시작해야 합니다 (아이폰 보안 정책)");
  }
  return `${base}/api/ebike/sync`;
}

async function request(init?: RequestInit): Promise<Response> {
  try {
    return await fetch(endpoint(), init);
  } catch (err) {
    if (err instanceof Error && err.message.includes("https://")) throw err;
    throw new Error(
      loadSyncServer()
        ? "PC 서버에 연결할 수 없습니다. PC가 켜져 있고 서버(dev.bat)와 연결 프로그램이 실행 중인지 확인하세요."
        : "서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.",
    );
  }
}

/** 서버 연결 확인 → 사용하는 저장소 종류 */
export async function checkSyncServer(): Promise<"pc" | "redis" | null> {
  const res = await request();
  const data = (await res.json().catch(() => ({}))) as { storage?: "pc" | "redis" | null };
  return data.storage ?? null;
}

async function api<T>(code: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await request({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`);
  return data as T;
}

const newer = <T extends { updatedAt: number }>(a: T | undefined, b: T): T =>
  a && a.updatedAt > b.updatedAt ? a : b;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 서버 한도(기록 하나 약 900KB)를 넘는 아주 긴 주행은 경로 점을 솎아서 올림 (내 폰의 기록은 그대로) */
const MAX_RIDE_JSON = 800_000;
function fitRide(ride: RideRecord): RideRecord {
  let r = ride;
  while (JSON.stringify(r).length > MAX_RIDE_JSON && r.points.length > 100) {
    const pts = r.points;
    r = { ...r, points: pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1) };
  }
  return r;
}

/** 요청 본문이 너무 커지지 않도록 크기 기준으로 묶음 */
function chunkBySize(rides: RideRecord[], maxBytes = 2_500_000, maxCount = 20): RideRecord[][] {
  const out: RideRecord[][] = [];
  let cur: RideRecord[] = [];
  let size = 0;
  for (const r of rides) {
    const s = JSON.stringify(r).length;
    if (cur.length && (size + s > maxBytes || cur.length >= maxCount)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

export type SyncResult = { uploaded: number; downloaded: number; deleted: number };

/** 이 기기와 서버의 기록을 합친다 (양방향) */
export async function syncNow(code: string): Promise<SyncResult> {
  const remote = await api<{ rideIds: string[]; meta: Meta | null }>(code, "pull");
  const meta = remote.meta ?? {};

  // 즐겨찾기·주차 위치: 더 최근에 바뀐 쪽을 사용
  const places = newer(meta.places, loadPlaces());
  const parking = newer(meta.parking, loadParking());
  savePlaces(places);
  saveParking(parking);

  // 삭제 기록 합치기 → 양쪽에서 지움
  // 백업으로 되살린 기록은 서버의 삭제 기록보다 우선
  const restored = new Set(loadRestoredRides());
  const deleted = new Set([...(meta.deleted ?? []), ...loadDeletedRides()].filter((id) => !restored.has(id)));
  saveDeletedRides([...deleted]);

  const localRides = await listRides();
  let deletedCount = 0;
  for (const r of localRides) {
    if (deleted.has(r.id)) {
      await deleteRide(r.id);
      deletedCount++;
    }
  }
  const remoteIds = new Set(remote.rideIds);
  const remoteToDelete = remote.rideIds.filter((id) => deleted.has(id));
  for (const batch of chunks(remoteToDelete, 20)) await api(code, "deleteRides", { ids: batch });

  const localIds = new Set(localRides.map((r) => r.id));
  const toUpload = localRides.filter((r) => !remoteIds.has(r.id) && !deleted.has(r.id));
  let failed = 0;
  for (const batch of chunkBySize(toUpload.map(fitRide))) {
    // 한 묶음이 실패해도 나머지(내려받기·즐겨찾기 동기화)는 계속
    try {
      await api(code, "putRides", { rides: batch });
    } catch (err) {
      console.warn("주행 기록 올리기 실패", err);
      failed += batch.length;
    }
  }

  const toDownload = remote.rideIds.filter((id) => !localIds.has(id) && !deleted.has(id));
  for (const batch of chunks(toDownload, 10)) {
    const { rides } = await api<{ rides: RideRecord[] }>(code, "getRides", { ids: batch });
    for (const r of rides) await saveRide(r);
  }

  await api(code, "putMeta", { meta: { places, parking, deleted: [...deleted] } satisfies Meta });
  saveRestoredRides([]);
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch {
    // 무시
  }
  return { uploaded: toUpload.length - failed, downloaded: toDownload.length, deleted: deletedCount };
}

// ───────────────────────── 파일 백업 · 복원 ─────────────────────────

type BackupFile = {
  app: "ara-ebike";
  version: 1;
  exportedAt: number;
  rides: RideRecord[];
  places: PlacesData;
  parking: ParkingData;
  deleted: string[];
};

export async function createBackup(): Promise<string> {
  const backup: BackupFile = {
    app: "ara-ebike",
    version: 1,
    exportedAt: Date.now(),
    rides: await listRides(),
    places: loadPlaces(),
    parking: loadParking(),
    deleted: loadDeletedRides(),
  };
  return JSON.stringify(backup);
}

/** 백업 파일을 현재 기록에 합친다 (기존 기록은 지우지 않음) */
export async function restoreBackup(text: string): Promise<number> {
  const data = JSON.parse(text) as Partial<BackupFile>;
  if (data.app !== "ara-ebike" || !Array.isArray(data.rides)) {
    throw new Error("전기자전거 백업 파일이 아닙니다");
  }
  const existing = new Set((await listRides()).map((r) => r.id));
  // 백업에서 되살린 기록은 삭제 목록에서 빼야 다음 동기화 때 다시 지워지지 않음
  const restored = new Set<string>();
  for (const r of data.rides) {
    if (!r?.id || !Array.isArray(r.points) || existing.has(r.id)) continue;
    await saveRide(r);
    restored.add(r.id);
  }
  if (data.places) savePlaces(newer(data.places, loadPlaces()));
  if (data.parking) saveParking(newer(data.parking, loadParking()));
  const deleted = [...loadDeletedRides(), ...(data.deleted ?? [])].filter((id) => !restored.has(id));
  saveDeletedRides(deleted);
  saveRestoredRides([...loadRestoredRides(), ...restored]);
  return restored.size;
}
