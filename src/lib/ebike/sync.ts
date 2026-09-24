/**
 * 여러 기기 동기화 (서버: /api/ebike/sync) 와 파일 백업·복원.
 */
import {
  loadDeletedRides,
  loadParking,
  loadPlaces,
  saveDeletedRides,
  saveParking,
  savePlaces,
  type ParkingData,
  type PlacesData,
} from "./places";
import { deleteRide, listRides, saveRide, type RideRecord } from "./rideStore";

type Meta = { places?: PlacesData; parking?: ParkingData; deleted?: string[] };

const CODE_KEY = "ebike-sync-code";
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

async function api<T>(code: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/ebike/sync", {
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
  const deleted = new Set([...(meta.deleted ?? []), ...loadDeletedRides()]);
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
  for (const batch of chunkBySize(toUpload)) await api(code, "putRides", { rides: batch });

  const toDownload = remote.rideIds.filter((id) => !localIds.has(id) && !deleted.has(id));
  for (const batch of chunks(toDownload, 10)) {
    const { rides } = await api<{ rides: RideRecord[] }>(code, "getRides", { ids: batch });
    for (const r of rides) await saveRide(r);
  }

  await api(code, "putMeta", { meta: { places, parking, deleted: [...deleted] } satisfies Meta });
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch {
    // 무시
  }
  return { uploaded: toUpload.length, downloaded: toDownload.length, deleted: deletedCount };
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
  let added = 0;
  for (const r of data.rides) {
    if (!r?.id || !Array.isArray(r.points) || existing.has(r.id)) continue;
    await saveRide(r);
    added++;
  }
  if (data.places) savePlaces(newer(data.places, loadPlaces()));
  if (data.parking) saveParking(newer(data.parking, loadParking()));
  if (data.deleted) saveDeletedRides([...loadDeletedRides(), ...data.deleted]);
  return added;
}
