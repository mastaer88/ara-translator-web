/**
 * 즐겨찾기 목적지 · 주차 위치 · 삭제한 주행 기록 목록 (브라우저 localStorage).
 * 각 묶음에 updatedAt을 두어 여러 기기 동기화 때 최신 값을 고른다.
 */
import type { LatLng } from "./geo";

export type SavedPlace = { id: string; name: string; lat: number; lng: number };

export type PlacesData = {
  home: SavedPlace | null;
  work: SavedPlace | null;
  favorites: SavedPlace[];
  updatedAt: number;
};

export type Parking = {
  lat: number;
  lng: number;
  accuracy: number | null;
  memo: string;
  savedAt: number;
};

export type ParkingData = { parking: Parking | null; updatedAt: number };

const PLACES_KEY = "ebike-places-v1";
const PARKING_KEY = "ebike-parking-v1";
const DELETED_KEY = "ebike-deleted-rides-v1";

export const EMPTY_PLACES: PlacesData = { home: null, work: null, favorites: [], updatedAt: 0 };
export const EMPTY_PARKING: ParkingData = { parking: null, updatedAt: 0 };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 공간 부족 등은 무시
  }
}

export const loadPlaces = () => read<PlacesData>(PLACES_KEY, EMPTY_PLACES);
export const savePlaces = (p: PlacesData) => write(PLACES_KEY, p);
export const loadParking = () => read<ParkingData>(PARKING_KEY, EMPTY_PARKING);
export const saveParking = (p: ParkingData) => write(PARKING_KEY, p);

/** 삭제한 주행 id (다른 기기에서 다시 내려받지 않도록) */
export function loadDeletedRides(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveDeletedRides(ids: string[]) {
  write(DELETED_KEY, Array.from(new Set(ids)));
}

export function makePlace(name: string, p: LatLng): SavedPlace {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, lat: p.lat, lng: p.lng };
}
