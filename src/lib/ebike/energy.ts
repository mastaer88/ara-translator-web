/**
 * 전기자전거 배터리 사용량 모델.
 * 구름저항 + 공기저항(맞바람 포함) + 오르막 에너지 중 모터가 맡는 비율(보조 단계)을 배터리 Wh로 환산한다.
 * 절대값은 사용자의 "1km당 소모량"(배터리 설정·학습값)에 맞춰 보정하고,
 * 모델은 오르막·보조 단계·바람에 따른 상대적인 차이를 계산한다.
 */
import { bearing, haversine, type LatLng } from "./geo";

export type AssistLevel = {
  id: string;
  name: string;
  /** 모터 보조 비율 (사람 힘 대비) */
  ratio: number;
  /** 이 단계로 달릴 때 평소 속도 (km/h) */
  kmh: number;
};

export const ASSIST_LEVELS: AssistLevel[] = [
  { id: "eco", name: "에코", ratio: 0.5, kmh: 17 },
  { id: "normal", name: "보통", ratio: 1, kmh: 20 },
  { id: "high", name: "하이", ratio: 2, kmh: 23 },
  { id: "turbo", name: "터보", ratio: 3, kmh: 25 },
];

/** 자전거 모델 (보조 단계·타이어·자세·모터 효율) */
export type BikeModel = {
  id: string;
  name: string;
  levels: AssistLevel[];
  /** 타이어 구름저항 계수 */
  crr: number;
  /** 공기저항 면적 (m²) */
  cda: number;
  /** 모터·컨트롤러 효율 */
  motorEff: number;
  motorW?: number;
  batteryV?: number;
  bikeKg?: number;
};

/** 직접 입력 (일반 전기자전거) */
export const GENERIC_BIKE: BikeModel = {
  id: "custom",
  name: "직접 입력",
  levels: ASSIST_LEVELS,
  crr: 0.008,
  cda: 0.6,
  motorEff: 0.7,
};

/**
 * 모토벨로 TX8 PRO3 (48V 500W, 20×2.4 팻타이어, 25.8kg, PAS 3단 + 스로틀)
 * unlocked: 속도 제한 해제 개조 기준 (단계별 속도 상향)
 * 보급형 케이던스 센서 PAS는 페달만 돌려도 모터가 많이 도와 보조 비율을 높게 잡음
 */
export function motoveloTx8Pro3(unlocked: boolean): BikeModel {
  return {
    id: unlocked ? "tx8pro3-unlocked" : "tx8pro3",
    name: unlocked ? "모토벨로 TX8 PRO3 (속도 해제)" : "모토벨로 TX8 PRO3",
    levels: unlocked
      ? [
          { id: "pas1", name: "1단", ratio: 1.2, kmh: 20 },
          { id: "pas2", name: "2단", ratio: 1.8, kmh: 28 },
          { id: "pas3", name: "3단", ratio: 3, kmh: 35 },
          { id: "throttle", name: "스로틀", ratio: 9, kmh: 35 },
        ]
      : [
          { id: "pas1", name: "1단", ratio: 1.2, kmh: 15 },
          { id: "pas2", name: "2단", ratio: 1.8, kmh: 20 },
          { id: "pas3", name: "3단", ratio: 3, kmh: 25 },
          { id: "throttle", name: "스로틀", ratio: 9, kmh: 25 },
        ],
    crr: 0.012, // 2.4인치 팻타이어
    cda: 0.65, // 미니벨로 똑바른 자세
    motorEff: 0.75,
    motorW: 500,
    batteryV: 48,
    bikeKg: 25.8,
  };
}

const G = 9.81;
const RHO = 1.2; // 공기 밀도
const STOP_GO = 1.3; // 신호 대기·출발 가속 손실

/** 코치·경로 비교의 기준 단계 위치 (가운데 단계) */
export const referenceIndex = (levelCount: number) => Math.floor((levelCount - 1) / 2);
export const referenceLevel = (m: BikeModel) => m.levels[referenceIndex(m.levels.length)];

export type EnergyOptions = {
  massKg: number;
  /** 배터리 설정의 1km당 소모량 (보통 단계·평지 기준으로 간주해 보정) */
  whPerKm: number;
  /** 바람 (없으면 무풍) */
  wind?: { ms: number; fromDeg: number } | null;
  /** 자전거 모델 (없으면 일반 전기자전거) */
  model?: BikeModel;
};

export type LevelEnergy = {
  level: AssistLevel;
  /** 경로 전체 배터리 사용량 (Wh) */
  wh: number;
  /** 경로 시작부터 각 점까지 누적 Wh (주행 중 남은 구간 계산용) */
  cumWh: number[];
  timeSec: number;
};

export type RouteEnergy = {
  levels: LevelEnergy[];
  distanceKm: number;
  climb: number;
  descent: number;
};

/** 모터가 맡는 몫 = r / (1 + r) */
const motorShare = (l: AssistLevel) => l.ratio / (1 + l.ratio);

/** 평지·무풍에서 1km당 배터리 Wh (보정 전, 이 모델의 물리값) */
export function flatWhPerKm(model: BikeModel, level: AssistLevel, massKg: number): number {
  const v = level.kmh / 3.6;
  const force = massKg * G * model.crr + 0.5 * RHO * model.cda * v * v;
  return ((force * 1000 * motorShare(level)) / model.motorEff / 3600) * STOP_GO;
}

/** 고도가 있는 경로의 보조 단계별 배터리 사용량 */
export function routeEnergy(coords: LatLng[], elev: number[] | null, opts: EnergyOptions): RouteEnergy {
  const model = opts.model ?? GENERIC_BIKE;
  // 사용자의 실제 소모량(기준 단계·평지)에 맞추는 보정 계수
  const scale = opts.whPerKm / flatWhPerKm(model, referenceLevel(model), opts.massKg);

  // 고도 잡음(±1~2m)으로 오르막이 부풀지 않도록 살짝 평활화
  const ele = elev && elev.length === coords.length ? smooth(elev, 2) : null;
  let climb = 0;
  let descent = 0;
  let distance = 0;
  for (let i = 1; i < coords.length; i++) distance += haversine(coords[i - 1], coords[i]);

  const levels = model.levels.map((level) => {
    const v = level.kmh / 3.6;
    const share = motorShare(level);
    const cumWh = [0];
    let wh = 0;
    let timeSec = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = haversine(coords[i - 1], coords[i]);
      if (d <= 0) {
        cumWh.push(wh);
        continue;
      }
      const dh = ele ? ele[i] - ele[i - 1] : 0;
      let vAir = v;
      if (opts.wind && opts.wind.ms > 0) {
        // 예보 바람은 지상 10m 기준이라 자전거 높이에서는 약 70%
        const hw =
          0.7 *
          opts.wind.ms *
          Math.cos(((opts.wind.fromDeg - bearing(coords[i - 1], coords[i])) * Math.PI) / 180);
        vAir = Math.max(0, v + hw);
      }
      // 구간 역학 에너지 (J). 내리막은 그 구간의 저항을 상쇄하는 만큼만 (회생 제동 없음)
      const joules = Math.max(
        0,
        opts.massKg * G * (model.crr * d + dh) + 0.5 * RHO * model.cda * vAir * vAir * d,
      );
      wh += ((joules * share) / model.motorEff / 3600) * STOP_GO * scale;
      cumWh.push(wh);
      timeSec += d / v;
    }
    return { level, wh, cumWh, timeSec };
  });

  if (ele) {
    for (let i = 1; i < ele.length; i++) {
      const dh = ele[i] - ele[i - 1];
      if (dh > 0) climb += dh;
      else descent -= dh;
    }
  }
  return { levels, distanceKm: distance / 1000, climb, descent };
}

function smooth(vals: number[], k: number): number[] {
  return vals.map((_, i) => {
    const s = vals.slice(Math.max(0, i - k), i + k + 1);
    return s.reduce((t, x) => t + x, 0) / s.length;
  });
}

export type CoachAdvice = {
  /** 추천 보조 단계 (배터리가 모자라면 null) */
  recommended: AssistLevel | null;
  /** 단계별 도착 시 예상 배터리 % */
  arrivePercent: Record<string, number>;
  /** 에코로도 부족할 때 모자라는 거리 (km) */
  shortKm: number | null;
};

/** 도착 시 여유(reserve %)를 남기면서 가장 힘을 덜 쓰는(높은) 보조 단계 추천 */
export function coach(
  energy: RouteEnergy,
  batteryPercent: number,
  capacityWh: number,
  reserve = 15,
): CoachAdvice {
  const arrivePercent: Record<string, number> = {};
  for (const l of energy.levels) {
    arrivePercent[l.level.id] = batteryPercent - (l.wh / capacityWh) * 100;
  }
  const ok = energy.levels.filter((l) => arrivePercent[l.level.id] >= reserve);
  const recommended = ok.length ? ok[ok.length - 1].level : null;
  let shortKm: number | null = null;
  if (!recommended) {
    const eco = energy.levels[0];
    const deficitWh = eco.wh - ((batteryPercent - reserve) / 100) * capacityWh;
    const ecoWhPerKm = eco.wh / Math.max(0.1, energy.distanceKm);
    shortKm = Math.max(0, deficitWh / ecoWhPerKm);
  }
  return { recommended, arrivePercent, shortKm };
}
