/**
 * 주행 기록 저장소 (브라우저 IndexedDB).
 * 기록은 이 기기의 Safari 안에만 저장된다.
 */

/** [위도, 경도, 시작 후 경과 초, 속도 km/h, 고도 m(있을 때만)] */
export type TrackPoint = [number, number, number, number, number?];

export type RideRecord = {
  id: string;
  startedAt: number;
  endedAt: number;
  distance: number;
  movingTime: number;
  elapsed: number;
  maxSpeed: number;
  points: TrackPoint[];
  startName?: string;
  endName?: string;
  /** 오토바이로 달린 기록 (없으면 전기자전거) */
  vehicle?: "moto";
};

export type RideTotals = {
  count: number;
  distance: number;
  movingTime: number;
  monthDistance: number;
  weekDistance: number;
  longest: number;
};

const DB_NAME = "ebike";
const RIDES = "rides";
const DRAFT = "draft";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RIDES)) db.createObjectStore(RIDES, { keyPath: "id" });
        if (!db.objectStoreNames.contains(DRAFT)) db.createObjectStore(DRAFT);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRide(ride: RideRecord): Promise<void> {
  await run(RIDES, "readwrite", (s) => s.put(ride));
}

export async function listRides(): Promise<RideRecord[]> {
  const rides = await run<RideRecord[]>(RIDES, "readonly", (s) => s.getAll());
  return rides.sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteRide(id: string): Promise<void> {
  await run(RIDES, "readwrite", (s) => s.delete(id));
}

/** 진행 중인 주행을 임시 저장 (Safari가 페이지를 닫아도 복구용) */
export async function saveDraft(ride: RideRecord): Promise<void> {
  await run(DRAFT, "readwrite", (s) => s.put(ride, "current"));
}

export async function takeDraft(): Promise<RideRecord | null> {
  const draft = await run<RideRecord | undefined>(DRAFT, "readonly", (s) => s.get("current"));
  await clearDraft();
  return draft ?? null;
}

export async function clearDraft(): Promise<void> {
  await run(DRAFT, "readwrite", (s) => s.delete("current"));
}

export function computeTotals(rides: RideRecord[], now = new Date()): RideTotals {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const day = (now.getDay() + 6) % 7; // 월요일 시작
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
  const totals: RideTotals = {
    count: rides.length,
    distance: 0,
    movingTime: 0,
    monthDistance: 0,
    weekDistance: 0,
    longest: 0,
  };
  for (const r of rides) {
    totals.distance += r.distance;
    totals.movingTime += r.movingTime;
    totals.longest = Math.max(totals.longest, r.distance);
    if (r.startedAt >= monthStart) totals.monthDistance += r.distance;
    if (r.startedAt >= weekStart) totals.weekDistance += r.distance;
  }
  return totals;
}
