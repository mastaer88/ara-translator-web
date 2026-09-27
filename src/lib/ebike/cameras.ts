/**
 * 과속·신호 단속 카메라 경고.
 * 데이터: 공공데이터포털 「전국무인교통단속카메라표준데이터」 파일(CSV) 또는 API 응답(JSON)을 불러와 이 기기에 저장한다.
 * 열 이름은 한국어(위도·경도·제한속도·단속구분)나 영어(latitude·longitude·lmttVe·regltSe) 모두 알아본다.
 */
import { bearing, haversine, type LatLng } from "./geo";

/**
 * [위도, 경도, 제한속도(0=모름), 종류(0 기타 · 1 과속 · 2 신호 · 3 신호+과속), 구간단속(0 아님 · 1 시작 · 2 끝)]
 * 예전에 저장한 데이터는 다섯 번째 값이 없을 수 있음
 */
export type Camera = [number, number, number, number, number?];

/** 앱에 들어 있는 기본 데이터 (scripts/ebike-cameras.mts로 만듦) */
export const BUNDLED_CAMERAS_URL = "/ebike/cameras.json";
/** 기본 데이터 기준일 — 이보다 오래된 기본 데이터를 가진 기기는 새로 받음 */
export const BUNDLED_CAMERAS_DATE = "2026-08-21";

export type CameraData = {
  cameras: Camera[];
  importedAt: number | null;
  /** 기본 제공 데이터인지, 직접 불러온 파일인지 */
  source?: "bundled" | "file";
  /** 데이터 기준일 (기본 제공 데이터) */
  dataDate?: string;
};

const KEY = "moto-cameras-v1";

export function loadCameras(): CameraData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // 무시
  }
  return { cameras: [], importedAt: null };
}

export function saveCameras(data: CameraData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** 기본 제공 데이터 받기 */
export async function fetchBundledCameras(): Promise<CameraData> {
  const res = await fetch(BUNDLED_CAMERAS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { date: string; cameras: Camera[] };
  return {
    cameras: data.cameras,
    importedAt: Date.now(),
    source: "bundled",
    dataDate: data.date,
  };
}

/** 파일 글자 인코딩: 공공데이터 CSV는 EUC-KR인 경우가 많음 */
export async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buf)
      .replace(/^﻿/, "");
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * 단속구분: 표준데이터는 숫자 코드 (1·01 과속, 2·02 신호, 1+2 신호+과속, 4·04 주정차, 3·99 기타),
 * 다른 자료는 글자(과속·신호)로 올 수 있음
 */
function kindOf(v: unknown): number {
  const s = String(v ?? "").trim();
  if (/^0?1\s*\+\s*0?2$/.test(s)) return 3;
  if (/^0?1$/.test(s)) return 1;
  if (/^0?2$/.test(s)) return 2;
  if (/^0?4$/.test(s)) return 4;
  const signal = /신호/.test(s);
  const speed = /과속|속도/.test(s);
  if (signal && speed) return 3;
  if (signal) return 2;
  if (speed) return 1;
  return 0;
}

function toCamera(
  lat: unknown,
  lng: unknown,
  limit: unknown,
  kind: unknown,
  section: unknown = "",
): Camera | null {
  const la = parseFloat(String(lat));
  const ln = parseFloat(String(lng));
  // 대한민국 범위만
  if (!(la > 33 && la < 39 && ln > 124 && ln < 132)) return null;
  const n = parseInt(String(limit ?? ""), 10);
  const lim = n > 0 && n < 200 ? n : 0;
  let k = kindOf(kind);
  // 주정차 단속은 달리는 중에는 알릴 필요 없음 (제한속도가 적혀 있으면 과속 카메라로 봄)
  if (k === 4) {
    if (!lim) return null;
    k = 0;
  }
  // 종류도 제한속도도 모르는 카메라는 알려도 도움이 안 됨
  if (k === 0 && !lim) return null;
  const sec = parseInt(String(section ?? ""), 10);
  return [
    Math.round(la * 1e5) / 1e5,
    Math.round(ln * 1e5) / 1e5,
    lim,
    k,
    sec === 1 || sec === 2 ? sec : 0,
  ];
}

/** 같은 자리(차로별로 여러 대)의 같은 카메라는 하나로 */
function dedupe(cams: Camera[]): Camera[] {
  const seen = new Set<string>();
  return cams.filter((c) => {
    const k = c.join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** CSV·JSON 텍스트 → 카메라 목록 */
export function parseCameras(text: string): Camera[] {
  const trimmed = text.trim();
  const out: Camera[] = [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed);
    const items: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : (data?.response?.body?.items ?? data?.items ?? data?.data ?? []);
    for (const it of Array.isArray(items) ? items : []) {
      const c = toCamera(
        it.latitude ?? it["위도"],
        it.longitude ?? it["경도"],
        it.lmttVe ?? it["제한속도"],
        it.regltSe ?? it["단속구분"],
        it.regltSctnLcSttus ?? it["단속구간위치구분"],
      );
      if (c) out.push(c);
    }
    return dedupe(out);
  }
  const rows = parseCsv(trimmed);
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const col = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(n)));
  const iLat = col("위도", "latitude");
  const iLng = col("경도", "longitude");
  const iLimit = col("제한속도", "lmttVe");
  const iKind = col("단속구분", "regltSe");
  const iSection = col("단속구간위치구분", "regltSctnLcSttus");
  if (iLat < 0 || iLng < 0) throw new Error("위도·경도 열을 찾지 못했습니다");
  for (const r of rows.slice(1)) {
    const c = toCamera(
      r[iLat],
      r[iLng],
      iLimit >= 0 ? r[iLimit] : "",
      iKind >= 0 ? r[iKind] : "",
      iSection >= 0 ? r[iSection] : "",
    );
    if (c) out.push(c);
  }
  return dedupe(out);
}

const cellKey = (lat: number, lng: number) =>
  `${Math.floor(lat * 100)}:${Math.floor(lng * 100)}`;

const angleDiff = (a: number, b: number) =>
  Math.abs(((a - b + 540) % 360) - 180);

export type CameraAlert = {
  kind: "ahead" | "slow";
  camera: Camera;
  distance: number;
};

/** 주행 중 앞쪽 카메라를 찾아 한 번씩 알림 */
export class CameraWatcher {
  private grid = new Map<string, Camera[]>();
  private announced = new Map<Camera, "ahead" | "slow">();

  constructor(cameras: Camera[]) {
    for (const c of cameras) {
      const k = cellKey(c[0], c[1]);
      const list = this.grid.get(k);
      if (list) list.push(c);
      else this.grid.set(k, [c]);
    }
  }

  get size() {
    let n = 0;
    for (const l of this.grid.values()) n += l.length;
    return n;
  }

  /** @param heading 진행 방향(도), 모르면 null — 이때는 알리지 않음 (옆길·반대편 카메라 오경보 방지) */
  update(
    p: LatLng,
    heading: number | null,
    kmh: number,
    aheadM = 500,
  ): CameraAlert[] {
    const alerts: CameraAlert[] = [];
    const la = Math.floor(p.lat * 100);
    const ln = Math.floor(p.lng * 100);
    const near: Camera[] = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        near.push(...(this.grid.get(`${la + i}:${ln + j}`) ?? []));

    for (const cam of near) {
      const pos = { lat: cam[0], lng: cam[1] };
      const d = haversine(p, pos);
      const state = this.announced.get(cam);
      if (d > aheadM + 300) {
        if (state) this.announced.delete(cam);
        continue;
      }
      if (heading === null || kmh < 10) continue;
      // 진행 방향 ±30도 안, 앞쪽에 있는 카메라만
      if (d > 30 && angleDiff(bearing(p, pos), heading) > 30) continue;
      if (!state && d <= aheadM && d > 60) {
        this.announced.set(cam, "ahead");
        // 차로·방향마다 따로 등록된 가까운 같은 카메라(150m 안, 같은 종류·제한속도)는 한 번만 알림
        for (const other of near)
          if (
            other !== cam &&
            !this.announced.has(other) &&
            other[2] === cam[2] &&
            other[3] === cam[3] &&
            haversine(pos, { lat: other[0], lng: other[1] }) < 150
          )
            this.announced.set(other, "ahead");
        alerts.push({ kind: "ahead", camera: cam, distance: d });
      } else if (
        state === "ahead" &&
        cam[4] !== 2 &&
        d <= 200 &&
        cam[2] > 0 &&
        kmh > cam[2]
      ) {
        this.announced.set(cam, "slow");
        alerts.push({ kind: "slow", camera: cam, distance: d });
      }
    }
    return alerts;
  }
}

/** 음성 문구 */
export function cameraPhrase(
  a: CameraAlert,
  spokenDistance: (m: number) => string,
): string {
  const [, , limit, kind, section] = a.camera;
  const dist = spokenDistance(Math.round(a.distance / 50) * 50);
  if (section === 2 && a.kind === "ahead") return `${dist} 앞 구간 단속 끝.`;
  if (section === 1 && a.kind === "ahead")
    return limit > 0
      ? `${dist} 앞 구간 단속 시작, 제한 속도 ${limit}킬로미터. 구간 평균 속도를 지키세요.`
      : `${dist} 앞 구간 단속 시작.`;
  if (a.kind === "slow")
    return `과속 단속 카메라입니다. 제한 속도 ${limit}킬로미터, 속도를 줄이세요.`;
  const what =
    kind === 2
      ? "신호 단속 카메라"
      : kind === 3
        ? "신호 과속 단속 카메라"
        : kind === 1
          ? "과속 단속 카메라"
          : "단속 카메라";
  return limit > 0
    ? `${dist} 앞 ${what}, 제한 속도 ${limit}킬로미터.`
    : `${dist} 앞 ${what}.`;
}
