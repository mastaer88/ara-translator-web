/**
 * 오토바이 모드: 연료(주행 가능 거리)·주행거리계·정비 알림.
 * 앱이 기록한 거리(m)와 계기판 km를 맞춰 두면, 정비 주기를 계기판 기준으로 볼 수 있다.
 */

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    // 저장소 접근 불가 시 기본값
  }
  return fallback;
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 무시
  }
}

// ───────────── 주행거리계 ─────────────
const ODO_KEY = "moto-odometer-v1";

/** 앱이 기록한 오토바이 누적 거리 (m) */
export function loadMotoOdo(): number {
  return load(ODO_KEY, { m: 0 }).m;
}

export function addMotoOdo(meters: number): number {
  const m = loadMotoOdo() + meters;
  save(ODO_KEY, { m });
  return m;
}

/** 계기판 km 맞추기: 입력 당시의 계기판 값과 앱 거리 */
export type Dashboard = { km: number | null; appOdoAt: number };
const DASH_KEY = "moto-dashboard-v1";

export const loadDashboard = (): Dashboard =>
  load(DASH_KEY, { km: null, appOdoAt: 0 });
export const saveDashboard = (d: Dashboard) => save(DASH_KEY, d);

/** 지금 계기판 km (맞춘 적 없으면 앱이 기록한 거리) */
export function dashboardKm(d: Dashboard, appOdo: number): number {
  return (d.km ?? 0) + (appOdo - (d.km === null ? 0 : d.appOdoAt)) / 1000;
}

// ───────────── 연료 ─────────────
export type FuelState = {
  /** 연료 탱크 (L) */
  tankL: number;
  /** 연비 (km/L) */
  kmPerL: number;
  /** 연비 학습 횟수 */
  learned: number;
  /** 마지막으로 알려 준 연료량 (L), 모르면 null */
  liters: number | null;
  /** 그때의 앱 누적 거리 (m) */
  odoAt: number;
  /** 마지막으로 가득 넣었을 때의 앱 누적 거리 (연비 학습용) */
  lastFullOdo: number | null;
  setAt: number | null;
};

const FUEL_KEY = "moto-fuel-v1";

/** 기본값: 125cc 스쿠터 기준 (설정에서 바꿀 수 있음) */
export const DEFAULT_FUEL: FuelState = {
  tankL: 8,
  kmPerL: 40,
  learned: 0,
  liters: null,
  odoAt: 0,
  lastFullOdo: null,
  setAt: null,
};

export const loadFuel = (): FuelState => load(FUEL_KEY, DEFAULT_FUEL);
export const saveFuel = (f: FuelState) => save(FUEL_KEY, f);

export type FuelEstimate = { liters: number; percent: number; rangeKm: number };

export function estimateFuel(f: FuelState, odo: number): FuelEstimate | null {
  if (f.liters === null) return null;
  const used = Math.max(0, odo - f.odoAt) / 1000 / f.kmPerL;
  const liters = Math.max(0, f.liters - used);
  return {
    liters,
    percent: (liters / f.tankL) * 100,
    rangeKm: liters * f.kmPerL,
  };
}

/**
 * 가득 주유: 넣은 양(L)을 알려 주면, 지난번 가득 주유 이후 달린 거리로 실제 연비를 학습한다.
 * @returns 새 상태와 이번에 잰 연비 (학습하지 않았으면 null)
 */
export function fillUp(
  f: FuelState,
  odo: number,
  addedL: number | null,
): { fuel: FuelState; measured: number | null } {
  let { kmPerL, learned } = f;
  let measured: number | null = null;
  if (f.lastFullOdo !== null && addedL && addedL > 0) {
    const km = (odo - f.lastFullOdo) / 1000;
    const m = km / addedL;
    if (km >= 20 && m >= 8 && m <= 120) {
      measured = Math.round(m * 10) / 10;
      const w = learned === 0 ? 0.7 : 0.3;
      kmPerL = Math.round((kmPerL * (1 - w) + m * w) * 10) / 10;
      learned += 1;
    }
  }
  return {
    fuel: {
      ...f,
      kmPerL,
      learned,
      liters: f.tankL,
      odoAt: odo,
      lastFullOdo: odo,
      setAt: Date.now(),
    },
    measured,
  };
}

/** 계기판 연료 눈금으로 맞추기 (가득 주유가 아니라 연비 학습은 안 함) */
export function setFuelPercent(
  f: FuelState,
  percent: number,
  odo: number,
): FuelState {
  return {
    ...f,
    liters: (f.tankL * percent) / 100,
    odoAt: odo,
    setAt: Date.now(),
  };
}

/** 이 거리(m)를 달리면 남는 연료 % */
export function fuelAfter(
  f: FuelState,
  est: FuelEstimate,
  meters: number,
): number {
  return est.percent - (meters / 1000 / f.kmPerL / f.tankL) * 100;
}

// ───────────── 정비 ─────────────
export type MaintItem = {
  id: string;
  name: string;
  /** 교체·점검 주기 (km) */
  everyKm: number;
  /** 마지막으로 한 때의 계기판 km, 모르면 null */
  lastKm: number | null;
  on: boolean;
};

const MAINT_KEY = "moto-maint-v1";

export const DEFAULT_MAINT: MaintItem[] = [
  { id: "oil", name: "엔진오일", everyKm: 3000, lastKm: null, on: true },
  {
    id: "gear",
    name: "기어오일 (스쿠터)",
    everyKm: 6000,
    lastKm: null,
    on: true,
  },
  {
    id: "chain",
    name: "체인 청소·급유",
    everyKm: 600,
    lastKm: null,
    on: false,
  },
  {
    id: "brake",
    name: "브레이크 패드 점검",
    everyKm: 5000,
    lastKm: null,
    on: true,
  },
  {
    id: "tire",
    name: "타이어 점검·교체",
    everyKm: 8000,
    lastKm: null,
    on: true,
  },
  { id: "air", name: "에어필터", everyKm: 6000, lastKm: null, on: true },
  { id: "plug", name: "점화 플러그", everyKm: 8000, lastKm: null, on: false },
];

export function loadMaint(): MaintItem[] {
  try {
    const raw = localStorage.getItem(MAINT_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as MaintItem[];
      // 새로 생긴 기본 항목도 보이게 합침
      return [
        ...saved,
        ...DEFAULT_MAINT.filter((d) => !saved.some((s) => s.id === d.id)),
      ];
    }
  } catch {
    // 무시
  }
  return DEFAULT_MAINT;
}

export const saveMaint = (items: MaintItem[]) => save(MAINT_KEY, items);

export type MaintStatus = {
  leftKm: number;
  ratio: number;
  level: "ok" | "soon" | "due";
} | null;

/** 다음 정비까지 남은 거리 (마지막 정비 km를 모르면 null) */
export function maintStatus(item: MaintItem, nowKm: number): MaintStatus {
  if (item.lastKm === null) return null;
  const used = Math.max(0, nowKm - item.lastKm);
  const leftKm = item.everyKm - used;
  const soonKm = Math.max(100, item.everyKm * 0.1);
  return {
    leftKm,
    ratio: Math.min(1, used / item.everyKm),
    level: leftKm <= 0 ? "due" : leftKm <= soonKm ? "soon" : "ok",
  };
}

/** 정비할 때가 된 항목 */
export function dueItems(items: MaintItem[], nowKm: number): MaintItem[] {
  return items.filter((i) => i.on && maintStatus(i, nowKm)?.level === "due");
}
