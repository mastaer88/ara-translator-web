"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  bearing,
  formatDistance,
  formatDuration,
  formatEta,
  haversine,
  projectOnRoute,
  spokenDistance,
  type LatLng,
} from "@/lib/ebike/geo";
import {
  NEARBY_KINDS,
  PROFILE_LABELS,
  ensureElevation,
  findBatteryCandidates,
  findBikeRoute,
  findWalkRoute,
  searchNearby,
  type NearbyKind,
  reverseGeocode,
  searchPlaces,
  type Maneuver,
  type Place,
  type Route,
  type RouteProfile,
  type TurnType,
} from "@/lib/ebike/routing";
import {
  clearDraft,
  deleteRide,
  listRides,
  saveDraft,
  saveRide,
  takeDraft,
  type RideRecord,
  type TrackPoint,
} from "@/lib/ebike/rideStore";
import { rideToGpx, shareFile } from "@/lib/ebike/gpx";
import {
  loadDeletedRides,
  loadParking,
  loadPlaces,
  makePlace,
  saveDeletedRides,
  saveParking,
  savePlaces,
  type ParkingData,
  type PlacesData,
  type SavedPlace,
} from "@/lib/ebike/places";
import { addressOf } from "@/lib/ebike/routing";
import { loadSyncCode, syncNow } from "@/lib/ebike/sync";
import { isNight } from "@/lib/ebike/sun";
import {
  estimateBattery,
  loadBattery,
  recordPercent,
  saveBattery,
  type BatteryState,
} from "@/lib/ebike/battery";
import { CrashDetector, requestMotionPermission } from "@/lib/ebike/crash";
import {
  describeWeather,
  fetchWeather,
  headwind,
  windEffectText,
  windName,
  type Weather,
} from "@/lib/ebike/weather";
import { getKoreanVoices, isSpeechSupported, speak, unlockSpeech } from "@/lib/ebike/voice";
import { loadSettings, saveSettings, type EbikeSettings } from "./settings";
import BatterySheet from "./BatterySheet";
import CoachPanel from "./CoachPanel";
import {
  GENERIC_BIKE,
  coach,
  flatWhPerKm,
  motoveloTx8Pro3,
  referenceLevel,
  routeEnergy,
  type AssistLevel,
  type BikeModel,
  type RouteEnergy,
} from "@/lib/ebike/energy";
import Onboarding, { markOnboarded, shouldShowOnboarding } from "./Onboarding";
import HistorySheet from "./HistorySheet";
import SosOverlay from "./SosOverlay";
import ParkingSheet from "./ParkingSheet";
import SyncSection from "./SyncSection";
import LocationSheet from "./LocationSheet";
import { BigButton, MapButton, Row, Section, Sheet, Slider, Stat, Toggle } from "./ui";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type RideStatus = "idle" | "riding" | "paused";
type GpsStatus = "off" | "waiting" | "on" | "error";
/** walk: 걸어서 가는 목적지 (주차 위치로 돌아가기 등) */
type Destination = { name: string; location: LatLng; walk?: boolean };

/** 걷기 안내의 기본 속도 (km/h) */
const WALK_KMH = 4.5;
type EtaBasis = "current" | "average" | "setting";
type NavProgress = {
  remaining: number;
  next: Maneuver | null;
  distToNext: number;
  /** 남은 시간 (초) — 현재 속도 기반 실시간 계산 */
  etaSec: number;
  etaKmh: number;
  etaBasis: EtaBasis;
  /** 도착 예정 시각 (ms) */
  arriveAt: number;
};

/** 이 속도(km/h) 이상이면 "달리는 중"으로 봄 */
const MOVING_KMH = 3;

/** 정확도가 이보다 나쁜 위치는 거리 누적에서 제외 (m) */
const MAX_ACCURACY = 35;
/** 경로 이탈 판정 거리 (m) */
const OFF_ROUTE_DIST = 45;
/** 도착 판정 거리 (m) */
const ARRIVE_DIST = 25;

/** 설정에 맞는 자전거 모델 */
function bikeModelOf(s: EbikeSettings): BikeModel {
  return s.bikeModel === "tx8pro3" ? motoveloTx8Pro3(s.speedUnlocked) : GENERIC_BIKE;
}

/** 보조 단계 코치: 도착 시 최소로 남길 배터리 (%) */
/** 현재 시각 (이벤트 처리용 — React 컴파일러가 렌더 중 호출로 오인하지 않도록 분리) */
const nowMs = () => Date.now();

const COACH_RESERVE = 15;

/** 받침 유무에 맞는 조사 ("에코를", "보통을", "에코로", "보통으로") */
function withParticle(word: string, withBatchim: string, without: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const has = code >= 0 && code <= 11171 && code % 28 !== 0;
  // "으로/로"는 ㄹ 받침 뒤에도 "로"
  const rieul = code >= 0 && code % 28 === 8;
  return word + (has && !(withBatchim === "으로" && rieul) ? withBatchim : without);
}

const THEME_LABEL: Record<EbikeSettings["mapTheme"], string> = {
  auto: "자동",
  light: "밝게",
  dark: "어둡게",
};
const NEXT_THEME: Record<EbikeSettings["mapTheme"], EbikeSettings["mapTheme"]> = {
  auto: "light",
  light: "dark",
  dark: "auto",
};

const EMPTY_RIDE = { distance: 0, movingTime: 0, maxSpeed: 0, elapsed: 0 };

const TURN_ICON: Record<TurnType, string> = {
  straight: "↑",
  left: "←",
  "slight-left": "↖",
  "sharp-left": "↙",
  right: "→",
  "slight-right": "↗",
  "sharp-right": "↘",
  "keep-left": "↖",
  "keep-right": "↗",
  uturn: "↶",
  roundabout: "⟳",
  arrive: "🏁",
};

type WakeLockSentinelLike = { release: () => Promise<void> };

export default function EbikeApp() {
  const [settings, setSettings] = useState<EbikeSettings>(loadSettings);
  const settingsRef = useRef(settings);

  // GPS
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("off");
  const [position, setPosition] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [speed, setSpeed] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  const lastFixRef = useRef<{ p: LatLng; t: number } | null>(null);
  const positionRef = useRef<LatLng | null>(null);

  // 주행 기록
  const [rideStatus, setRideStatus] = useState<RideStatus>("idle");
  const rideStatusRef = useRef<RideStatus>("idle");
  const rideRef = useRef({ ...EMPTY_RIDE });
  const [ride, setRide] = useState(EMPTY_RIDE);
  const periodicRef = useRef({ lastTime: 0, lastDistance: 0 });
  const trackRef = useRef<TrackPoint[]>([]);
  const startedAtRef = useRef(0);
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [viewing, setViewing] = useState<RideRecord | null>(null);
  const overSpeedRef = useRef({ count: 0, lastWarn: 0 });
  /** 도착 시간 계산용 속도: 지금 속도와 최근 몇 초 평균(지수 이동 평균) */
  const etaSpeedRef = useRef<{ live: number; smooth: number | null }>({ live: 0, smooth: null });
  const [overSpeed, setOverSpeed] = useState(false);

  // 내비게이션
  const [destination, setDestination] = useState<Destination | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routing, setRouting] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [progress, setProgress] = useState<NavProgress | null>(null);
  const navRef = useRef({
    route: null as Route | null,
    destination: null as Destination | null,
    navigating: false,
    announced: new Map<number, Set<"straight" | "far" | "near">>(),
    /** 보조 단계 코치: 마지막으로 확인한 지점(m)과 추천 단계 */
    lastCoachAt: 0,
    lastRec: "" as string,
    offCount: 0,
    lastReroute: 0,
    rerouting: false,
  });

  // 화면
  const [sheet, setSheet] = useState<
    "nav" | "settings" | "history" | "location" | "parking" | "battery" | null
  >(null);
  const [places, setPlaces] = useState<PlacesData>(loadPlaces);
  const [parkingData, setParkingData] = useState<ParkingData>(loadParking);
  const [savingParking, setSavingParking] = useState(false);
  const [focus, setFocus] = useState<{ p: LatLng; key: number } | null>(null);
  const [syncCode, setSyncCode] = useState<string | null>(loadSyncCode);
  const syncCodeRef = useRef(syncCode);
  const syncingRef = useRef(false);
  const [follow, setFollow] = useState(true);
  const [locating, setLocating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [candidates, setCandidates] = useState<Route[] | null>(null);
  const [coachLive, setCoachLive] = useState<string | null>(null);
  /** 경로 계산·주행 중 코치가 최신 배터리·날씨·에너지를 읽기 위한 참조 */
  const energyRef = useRef<{
    whPerKm: number;
    wind: { ms: number; fromDeg: number } | null;
    energy: RouteEnergy | null;
    percent: number | null;
    capacity: number;
  }>({ whPerKm: 10, wind: null, energy: null, percent: null, capacity: 360 });
  const [onboarding, setOnboarding] = useState(shouldShowOnboarding);
  const [bigSpeed, setBigSpeed] = useState(false);
  const [night, setNight] = useState(() => isNight());
  const [battery, setBattery] = useState<BatteryState>(loadBattery);
  const lowBatteryRef = useRef<number | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [sos, setSos] = useState<"check" | "sos" | null>(null);
  const [sosAddress, setSosAddress] = useState<string | null>(null);
  const crashRef = useRef<CrashDetector | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
  }, [settings]);

  const update = useCallback(<K extends keyof EbikeSettings>(key: K, value: EbikeSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const say = useCallback((text: string, interrupt = false) => {
    const s = settingsRef.current;
    if (!s.voiceEnabled) return;
    speak(text, { rate: s.rate, volume: s.volume, voiceURI: s.voiceURI }, interrupt);
  }, []);

  // 한국어 음성 목록 (iOS는 비동기로 로드됨)
  useEffect(() => {
    if (!isSpeechSupported()) return;
    const load = () => setVoices(getKoreanVoices());
    const timer = setTimeout(load, 0);
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      clearTimeout(timer);
      window.speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, []);

  // ───────────── 화면 꺼짐 방지 (Screen Wake Lock, iOS 16.4+) ─────────────
  const acquireWakeLock = useCallback(async () => {
    if (!settingsRef.current.keepAwake || wakeLockRef.current) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> };
    };
    try {
      wakeLockRef.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && rideStatusRef.current !== "idle") {
        wakeLockRef.current = null; // 백그라운드 전환 시 자동 해제되므로 다시 요청
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [acquireWakeLock]);

  // ───────────── 경로 탐색 ─────────────
  const computeRoute = useCallback(
    async (dest: Destination, from?: LatLng | null, profile?: RouteProfile) => {
      const origin = from ?? positionRef.current ?? (await getCurrentPosition().catch(() => null));
      if (!origin) {
        toast.error("현재 위치를 알 수 없습니다. 위치 권한을 확인하세요.");
        return null;
      }
      setRouting(true);
      try {
        const prof = profile ?? settingsRef.current.profile;
        let r: Route;
        if (!dest.walk && prof === "battery") {
          // 여러 경로의 배터리 사용량(보통 단계)을 계산해 가장 적은 경로 선택
          const s = settingsRef.current;
          const e = energyRef.current;
          const list = await findBatteryCandidates(origin, dest.location);
          const scored = list
            .map((c) => ({
              c,
              wh: (() => {
                const model = bikeModelOf(s);
                const en = routeEnergy(c.coords, c.elev ?? null, {
                  massKg: s.riderKg + s.bikeKg,
                  whPerKm: e.whPerKm,
                  wind: e.wind,
                  model,
                });
                return en.levels[model.levels.indexOf(referenceLevel(model))].wh;
              })(),
            }))
            .sort((a, b) => a.wh - b.wh);
          r = scored[0].c;
          setCandidates(scored.map((x) => x.c));
        } else {
          r = dest.walk
            ? await findWalkRoute(origin, dest.location)
            : await findBikeRoute(origin, dest.location, prof);
          setCandidates(null);
        }
        if (r.note) toast.info(r.note);
        navRef.current.route = r;
        navRef.current.announced = new Map();
        navRef.current.offCount = 0;
        navRef.current.lastCoachAt = 0;
        setRoute(r);
        // 고도가 없는 경로(카카오 등)는 뒤에서 고도를 채워 배터리 계산을 정확하게
        if (!dest.walk && !r.elev) {
          ensureElevation(r).then((withElev) => {
            if (navRef.current.route !== r || !withElev.elev) return;
            navRef.current.route = withElev;
            setRoute(withElev);
          });
        }
        return r;
      } catch (err) {
        toast.error(`경로 탐색 실패: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        setRouting(false);
      }
    },
    [],
  );

  const stopNavigation = useCallback(() => {
    navRef.current.navigating = false;
    setNavigating(false);
    setProgress(null);
  }, []);

  const clearDestination = useCallback(() => {
    stopNavigation();
    navRef.current.route = null;
    navRef.current.destination = null;
    setRoute(null);
    setDestination(null);
  }, [stopNavigation]);

  // ───────────── 길 안내 진행 ─────────────
  /**
   * 도착까지 남은 시간 (현재 속도 기반 실시간 계산)
   * - 달리는 중: 최근 몇 초 평균 속도
   * - 신호 대기 등 정지 중: 이번 주행의 평균 속도 (무한대로 늘어나지 않게)
   * - 속도 정보 없음: 설정의 기본 속도
   */
  const estimateEta = useCallback((remaining: number) => {
    const { live, smooth } = etaSpeedRef.current;
    const r = rideRef.current;
    const rideAvg = r.movingTime > 20 ? (r.distance / r.movingTime) * 3.6 : null;
    let kmh: number;
    let basis: EtaBasis;
    if (live > MOVING_KMH && smooth !== null) {
      kmh = smooth;
      basis = "current";
    } else if (rideAvg !== null && rideAvg > MOVING_KMH) {
      kmh = rideAvg;
      basis = "average";
    } else if (smooth !== null) {
      kmh = smooth;
      basis = "average";
    } else {
      kmh = navRef.current.route?.walk ? WALK_KMH : settingsRef.current.cruiseSpeed;
      basis = "setting";
    }
    const etaSec = remaining / (kmh / 3.6);
    return { etaSec, etaKmh: kmh, etaBasis: basis, arriveAt: Date.now() + etaSec * 1000 };
  }, []);

  const updateNavigation = useCallback(
    (p: LatLng, acc: number) => {
      const nav = navRef.current;
      const r = nav.route;
      if (!nav.navigating || !r || !nav.destination) return;

      const proj = projectOnRoute(p, r.coords, r.cum);

      // 경로 이탈 → 재탐색
      if (proj.distFromRoute > Math.max(OFF_ROUTE_DIST, acc) && acc <= 60) {
        nav.offCount++;
        const now = Date.now();
        if (nav.offCount >= 3 && !nav.rerouting && now - nav.lastReroute > 15000) {
          nav.rerouting = true;
          nav.lastReroute = now;
          if (settingsRef.current.navVoice) say("경로를 벗어났습니다. 경로를 다시 탐색합니다.", true);
          computeRoute(nav.destination, p)
            .then((newRoute) => {
              if (newRoute && nav.navigating && settingsRef.current.navVoice) {
                say(`새 경로로 안내합니다. 목적지까지 ${spokenDistance(newRoute.distance)}입니다.`);
              }
            })
            .finally(() => {
              nav.rerouting = false;
            });
        }
      } else {
        nav.offCount = 0;
      }

      const remaining = Math.max(0, r.distance - proj.distAlong);
      const straightToDest = haversine(p, nav.destination.location);
      if (remaining <= ARRIVE_DIST || straightToDest <= ARRIVE_DIST) {
        if (settingsRef.current.navVoice) say("목적지에 도착했습니다. 길 안내를 종료합니다.", true);
        toast.success("목적지에 도착했습니다 🎉");
        stopNavigation();
        return;
      }

      const idx = r.maneuvers.findIndex((m) => m.distAlong > proj.distAlong + 3);
      const next = idx >= 0 ? r.maneuvers[idx] : null;
      const distToNext = next ? next.distAlong - proj.distAlong : remaining;
      setProgress({ remaining, next, distToNext, ...estimateEta(remaining) });

      // 보조 단계 코치: 1km마다 남은 구간의 배터리를 다시 계산해 추천 단계가 바뀌면 알림
      const ec = energyRef.current;
      if (ec.energy && ec.percent !== null && proj.distAlong - nav.lastCoachAt >= 1000) {
        nav.lastCoachAt = proj.distAlong;
        const at = Math.min(proj.index, ec.energy.levels[0].cumWh.length - 1);
        let rec: AssistLevel | null = null;
        let recArrive = 0;
        for (const l of ec.energy.levels) {
          const arrive = ec.percent - ((l.wh - l.cumWh[at]) / ec.capacity) * 100;
          if (arrive >= COACH_RESERVE) {
            rec = l.level;
            recArrive = arrive;
          }
        }
        const id = rec?.id ?? "none";
        const levels = ec.energy.levels;
        if (id !== nav.lastRec) {
          const idxOf = (x: string) => levels.findIndex((l) => l.level.id === x);
          const lower = idxOf(id) < idxOf(nav.lastRec);
          nav.lastRec = id;
          setCoachLive(
            rec
              ? `추천 보조 ${rec.name} · 도착 ${Math.round(recArrive)}%`
              : "배터리 부족 — 가장 낮은 단계로 달리세요",
          );
          if (settingsRef.current.navVoice) {
            say(
              !rec
                ? `배터리가 부족할 수 있습니다. ${levels[0].level.name} 단계로 달리고 충전을 고려하세요.`
                : lower
                  ? `배터리를 아끼려면 보조 단계를 ${withParticle(rec.name, "으로", "로")} 낮추세요.`
                  : `배터리 여유가 있습니다. ${withParticle(rec.name, "으로", "로")} 올려도 도착할 수 있습니다.`,
            );
          }
        }
      }

      if (!next || !settingsRef.current.navVoice) return;
      const stages = nav.announced.get(idx) ?? new Set();
      nav.announced.set(idx, stages);

      if (next.type === "arrive") {
        if (distToNext <= 120 && !stages.has("near")) {
          stages.add("near").add("far").add("straight");
          say("잠시 후 목적지에 도착합니다.");
        } else if (distToNext > 400 && !stages.has("straight")) {
          stages.add("straight");
          say(`목적지까지 ${spokenDistance(distToNext)} 직진입니다.`);
        }
        return;
      }
      if (distToNext <= 60 && !stages.has("near")) {
        stages.add("near").add("far").add("straight");
        say(`잠시 후 ${next.text}`, true);
      } else if (distToNext <= 250 && distToNext > 90 && !stages.has("far")) {
        stages.add("far").add("straight");
        say(aheadPhrase(distToNext, next.text));
      } else if (distToNext > 400 && !stages.has("straight")) {
        // 회전 직후 다음 안내까지 멀면 직진 거리를 알려줌
        stages.add("straight");
        say(`${spokenDistance(distToNext)} 직진 후 ${next.text}`);
      }
    },
    [computeRoute, say, stopNavigation, estimateEta],
  );

  // ───────────── GPS 위치 처리 ─────────────
  const handleFix = useCallback(
    (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy: acc, speed: rawSpeed, heading: rawHeading } = pos.coords;
      const p = { lat: latitude, lng: longitude };
      const t = pos.timestamp;
      const last = lastFixRef.current;
      const s = settingsRef.current;

      // 속도 계산: GPS 제공 속도 우선, 없으면 이동 거리로 계산
      let kmh = 0;
      let step = 0;
      let dt = 0;
      if (last) {
        step = haversine(last.p, p);
        dt = (t - last.t) / 1000;
      }
      if (rawSpeed !== null && rawSpeed >= 0) kmh = rawSpeed * 3.6;
      else if (dt > 0) kmh = (step / dt) * 3.6;
      if (kmh < 1.5 || kmh > 90) kmh = 0; // 정지 중 GPS 흔들림·튀는 값 제거

      // 도착 시간용 속도: 달리는 동안의 속도를 약 5초 단위로 부드럽게 평균
      const eta = etaSpeedRef.current;
      eta.live = kmh;
      if (kmh > MOVING_KMH) eta.smooth = eta.smooth === null ? kmh : eta.smooth * 0.8 + kmh * 0.2;

      setSpeed((prev) => (kmh === 0 ? 0 : prev * 0.3 + kmh * 0.7));
      setPosition(p);
      setAccuracy(acc);
      if (rawHeading !== null && !Number.isNaN(rawHeading) && rawHeading >= 0 && kmh > 3)
        setHeading(rawHeading);
      // 방향 정보가 없으면 직전 위치에서 이동한 방향으로 계산
      else if (last && step >= 5 && kmh > 3) setHeading(bearing(last.p, p));
      positionRef.current = p;
      setGpsStatus("on");

      // 주행 기록 누적
      const good = acc <= MAX_ACCURACY;
      if (!last || good) lastFixRef.current = { p, t };
      if (rideStatusRef.current === "riding" && last && good && dt > 0) {
        const r = rideRef.current;
        if (step / dt < 25 && (step >= 3 || kmh > 3)) r.distance += step;
        if (kmh > 3) r.movingTime += dt;
        r.maxSpeed = Math.max(r.maxSpeed, kmh);
        setRide({ ...r });

        // 코스 기록: 5m 이상 움직였을 때만 점 추가
        const track = trackRef.current;
        const prev = track[track.length - 1];
        if (!prev || haversine({ lat: prev[0], lng: prev[1] }, p) >= 5) {
          const point: TrackPoint = [
            Math.round(p.lat * 1e6) / 1e6,
            Math.round(p.lng * 1e6) / 1e6,
            Math.round((t - startedAtRef.current) / 1000),
            Math.round(kmh * 10) / 10,
          ];
          if (pos.coords.altitude !== null) point.push(Math.round(pos.coords.altitude * 10) / 10);
          track.push(point);
        }

        // 거리 기준 주기 안내
        if (s.periodicMode === "distance") {
          const every = s.periodicKm * 1000;
          if (r.distance - periodicRef.current.lastDistance >= every) {
            periodicRef.current.lastDistance = Math.floor(r.distance / every) * every;
            say(`주행 거리 ${spokenDistance(r.distance)}, 현재 시속 ${Math.round(kmh)}킬로미터`);
          }
        }
      }

      // 속도 초과 경고
      if (s.speedWarn && kmh > s.speedLimit) {
        overSpeedRef.current.count++;
        setOverSpeed(true);
        const now = Date.now();
        if (overSpeedRef.current.count >= 2 && now - overSpeedRef.current.lastWarn > 15000) {
          overSpeedRef.current.lastWarn = now;
          say(`속도를 줄이세요. 현재 시속 ${Math.round(kmh)}킬로미터입니다.`);
        }
      } else {
        overSpeedRef.current.count = 0;
        setOverSpeed(false);
      }

      if (rideStatusRef.current === "riding") crashRef.current?.feedSpeed(kmh);
      updateNavigation(p, acc);
    },
    [say, updateNavigation],
  );

  const handleFixRef = useRef(handleFix);
  useEffect(() => {
    handleFixRef.current = handleFix;
  }, [handleFix]);

  const startGps = useCallback(() => {
    if (watchIdRef.current !== null) return;
    if (!("geolocation" in navigator)) {
      setGpsStatus("error");
      toast.error("이 브라우저는 위치 서비스를 지원하지 않습니다.");
      return;
    }
    setGpsStatus("waiting");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => handleFixRef.current(pos),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus("error");
          toast.error(
            "위치 권한이 거부되었습니다. 설정 > 개인정보 보호 > 위치 서비스 > Safari에서 허용해 주세요.",
          );
        } else {
          // 시간 초과·일시적 수신 불가(정차, 터널 등)는 감시가 계속되므로 상태만 표시
          setGpsStatus("waiting");
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }, []);

  const stopGps = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    lastFixRef.current = null;
    setGpsStatus("off");
    setSpeed(0);
    setOverSpeed(false);
    overSpeedRef.current.count = 0;
  }, []);

  useEffect(() => () => stopGps(), [stopGps]);

  // ───────────── 주행 기록 저장 ─────────────
  // 주행 기록 스냅샷 (ref만 읽으므로 항상 최신 값)
  const buildRecord = useCallback((): RideRecord => {
    const r = rideRef.current;
    return {
      id: String(startedAtRef.current),
      startedAt: startedAtRef.current,
      endedAt: Date.now(),
      distance: r.distance,
      movingTime: r.movingTime,
      elapsed: r.elapsed,
      maxSpeed: r.maxSpeed,
      points: [...trackRef.current],
    };
  }, []);

  const refreshRides = useCallback(() => {
    listRides()
      .then(setRides)
      .catch(() => {});
  }, []);

  useEffect(() => {
    syncCodeRef.current = syncCode;
  }, [syncCode]);

  /** 동기화·복원 후 화면 데이터 다시 읽기 */
  const reloadLocalData = useCallback(() => {
    refreshRides();
    setPlaces(loadPlaces());
    setParkingData(loadParking());
  }, [refreshRides]);

  /** 동기화가 켜져 있으면 조용히 동기화 (실패해도 알림 없음) */
  const autoSync = useCallback(() => {
    const code = syncCodeRef.current;
    if (!code || syncingRef.current) return;
    syncingRef.current = true;
    syncNow(code)
      .then(reloadLocalData)
      .catch((err) => console.warn("자동 동기화 실패", err))
      .finally(() => {
        syncingRef.current = false;
      });
  }, [reloadLocalData]);

  /** 주행 저장 후 출발·도착지 이름을 찾아 덧붙임 */
  const persistRide = useCallback(
    async (rec: RideRecord) => {
      await clearDraft().catch(() => {});
      if (rec.distance < 50 || rec.points.length < 2) {
        toast.info("주행 거리가 짧아 기록을 저장하지 않았습니다.");
        return;
      }
      try {
        await saveRide(rec);
        refreshRides();
        const [a, b] = [rec.points[0], rec.points[rec.points.length - 1]];
        const [startName, endName] = await Promise.all([
          reverseGeocode({ lat: a[0], lng: a[1] }),
          reverseGeocode({ lat: b[0], lng: b[1] }),
        ]);
        await saveRide({ ...rec, startName, endName });
        refreshRides();
        autoSync();
      } catch {
        toast.error("주행 기록을 저장하지 못했습니다.");
      }
    },
    [refreshRides, autoSync],
  );

  // 처음 열 때: 기록 목록 로드 + 비정상 종료된 주행 복구
  useEffect(() => {
    takeDraft()
      .then((draft) => {
        if (draft && draft.distance >= 50) {
          toast.info(`이전 주행(${formatDistance(draft.distance)})을 기록에 저장했습니다.`);
          return persistRide(draft);
        }
      })
      .catch(() => {})
      .finally(() => {
        refreshRides();
        autoSync();
      });
  }, [persistRide, refreshRides, autoSync]);

  const viewRide = (r: RideRecord) => {
    setViewing(r);
    setFollow(false);
    setSheet(null);
  };

  const exportRide = (r: RideRecord) => {
    const d = new Date(r.startedAt);
    const name = `ebike-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.gpx`;
    shareFile(name, rideToGpx(r), "application/gpx+xml");
  };

  const removeRide = async (r: RideRecord) => {
    await deleteRide(r.id);
    saveDeletedRides([...loadDeletedRides(), r.id]);
    if (viewing?.id === r.id) setViewing(null);
    refreshRides();
    autoSync();
  };

  // 1초 타이머: 경과 시간 + 시간 기준 주기 안내
  useEffect(() => {
    if (rideStatus !== "riding") return;
    const id = setInterval(() => {
      const r = rideRef.current;
      r.elapsed += 1;
      setRide({ ...r });
      if (r.elapsed % 30 === 0) saveDraft(buildRecord()).catch(() => {});
      const s = settingsRef.current;
      if (s.periodicMode === "time" && r.elapsed - periodicRef.current.lastTime >= s.periodicMinutes * 60) {
        periodicRef.current.lastTime = r.elapsed;
        const avg = r.movingTime > 0 ? (r.distance / r.movingTime) * 3.6 : 0;
        say(
          `주행 시간 ${Math.round(r.elapsed / 60)}분, 거리 ${spokenDistance(r.distance)}, ` +
            `평균 시속 ${Math.round(avg)}킬로미터`,
        );
      }
    }, 1000);
    return () => clearInterval(id);
  }, [rideStatus, say, buildRecord]);

  // ───────────── 넘어짐 감지 · SOS ─────────────
  /** 긴급 안내는 음성 설정과 관계없이 읽음 */
  const sayUrgent = useCallback((text: string) => {
    const s = settingsRef.current;
    speak(text, { rate: s.rate, volume: 1, voiceURI: s.voiceURI }, true);
  }, []);
  const openSosScreen = useCallback(() => setSos("sos"), []);

  const showWeather = () => {
    if (!weather) return;
    toast.info(
      `${describeWeather(weather.code).text} ${Math.round(weather.tempC)}°C · ${windName(weather.windFromDeg)} ` +
        `${weather.windMs.toFixed(1)}m/s (돌풍 ${weather.gustMs.toFixed(0)}) · 3시간 내 비 ${weather.rainChance}%`,
      { duration: 5000 },
    );
  };
  function openSos(mode: "check" | "sos") {
    setSos(mode);
    const p = positionRef.current;
    if (p) addressOf(p).then(setSosAddress);
  }

  // ───────────── 배터리 ─────────────
  const updateBattery = (b: BatteryState) => {
    saveBattery(b);
    setBattery(b);
  };

  // ───────────── 날씨 (15분마다) ─────────────
  const hasPosition = position !== null;
  useEffect(() => {
    if (!hasPosition) return;
    const load = () => {
      const p = positionRef.current;
      if (p)
        fetchWeather(p)
          .then(setWeather)
          .catch((err) => console.warn("날씨 실패", err));
    };
    load();
    const id = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [hasPosition]);

  // ───────────── 주행 제어 ─────────────
  const setRideStatusBoth = (s: RideStatus) => {
    rideStatusRef.current = s;
    setRideStatus(s);
  };

  const startRide = () => {
    unlockSpeech(); // iOS: 터치 이벤트 안에서 음성 활성화
    startGps();
    acquireWakeLock();
    if (settingsRef.current.crashDetect && !crashRef.current) {
      // iOS: 움직임 센서 권한도 터치 이벤트 안에서 요청해야 함
      requestMotionPermission().then((ok) => {
        if (!ok) {
          toast.info("움직임 센서 권한이 없어 넘어짐 감지를 쓸 수 없습니다.");
          return;
        }
        crashRef.current = new CrashDetector(() => openSos("check"));
        crashRef.current.start();
      });
    }
    if (rideStatus === "idle") {
      rideRef.current = { ...EMPTY_RIDE };
      periodicRef.current = { lastTime: 0, lastDistance: 0 };
      trackRef.current = [];
      startedAtRef.current = nowMs();
      etaSpeedRef.current = { live: 0, smooth: null };
      setViewing(null);
      setRide({ ...rideRef.current });
      say("주행을 시작합니다.");
    } else {
      say("주행을 다시 시작합니다.");
    }
    setRideStatusBoth("riding");
  };

  const pauseRide = () => {
    setRideStatusBoth("paused");
    say("일시 정지");
  };

  const endRide = () => {
    const r = rideRef.current;
    const avg = r.movingTime > 0 ? (r.distance / r.movingTime) * 3.6 : 0;
    say(`주행을 종료합니다. 총 ${spokenDistance(r.distance)}, 평균 시속 ${Math.round(avg)}킬로미터`, true);
    toast.success(
      `주행 종료 · ${formatDistance(r.distance)} · ${formatDuration(r.elapsed)} · 평균 ${avg.toFixed(1)}km/h`,
      {
        duration: 15000,
        action: { label: "🅿️ 주차 위치 저장", onClick: () => saveParkingHere("") },
      },
    );
    setRideStatusBoth("idle");
    stopNavigation();
    stopGps();
    releaseWakeLock();
    crashRef.current?.stop();
    crashRef.current = null;
    persistRide(buildRecord());
  };

  // ───────────── 목적지 검색 ─────────────
  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const list = await searchPlaces(q, positionRef.current);
      setResults(list);
      if (list.length === 0) toast.info("검색 결과가 없습니다.");
    } catch {
      toast.error("장소 검색에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  };

  // ───────────── 주변 찾기 (카카오) ─────────────
  const [nearbyKind, setNearbyKind] = useState<string | null>(null);
  const findNearby = async (kind: NearbyKind) => {
    const near = positionRef.current ?? (await getCurrentPosition().catch(() => null));
    if (!near) {
      toast.error("현재 위치를 알 수 없습니다.");
      return;
    }
    setSearching(true);
    setNearbyKind(kind.id);
    try {
      const list = await searchNearby(kind, near);
      if (list === null) {
        toast.info("주변 찾기는 카카오 키가 설정되어야 쓸 수 있습니다.");
        return;
      }
      setResults(list);
      if (list.length === 0) toast.info(`근처에 ${kind.label}이(가) 없습니다.`);
    } catch {
      toast.error("주변 찾기에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const chooseDestination = async (dest: Destination) => {
    stopNavigation();
    setDestination(dest);
    navRef.current.destination = dest;
    setResults([]);
    setFollow(false);
    await computeRoute(dest);
  };

  const onPick = async (p: LatLng) => {
    setPickMode(false);
    setSheet("nav");
    const name = await reverseGeocode(p);
    chooseDestination({ name, location: p });
  };

  // ───────────── 즐겨찾기 목적지 ─────────────
  const updatePlaces = (next: Omit<PlacesData, "updatedAt">) => {
    const data = { ...next, updatedAt: Date.now() };
    savePlaces(data);
    setPlaces(data);
    autoSync();
  };

  const saveFavorite = (kind: "home" | "work" | "fav") => {
    if (!destination) return;
    if (kind === "fav") {
      const name = prompt("즐겨찾기 이름", destination.name)?.trim();
      if (!name) return;
      updatePlaces({ ...places, favorites: [...places.favorites, makePlace(name, destination.location)] });
      toast.success(`'${name}'을(를) 즐겨찾기에 추가했습니다`);
    } else {
      const label = kind === "home" ? "집" : "회사";
      updatePlaces({ ...places, [kind]: makePlace(destination.name, destination.location) });
      toast.success(`${label}(으)로 저장했습니다`);
    }
  };

  const goToPlace = (pl: SavedPlace | null, label: string) => {
    if (!pl) {
      toast.info(`${label}이(가) 아직 없습니다. 목적지를 검색한 뒤 '${label}(으)로 저장'을 눌러 주세요.`);
      return;
    }
    setSheet("nav");
    chooseDestination({ name: pl.name, location: { lat: pl.lat, lng: pl.lng } });
  };

  const removeFavorite = (pl: SavedPlace) => {
    if (!confirm(`'${pl.name}'을(를) 즐겨찾기에서 지울까요?`)) return;
    updatePlaces({ ...places, favorites: places.favorites.filter((f) => f.id !== pl.id) });
  };

  // ───────────── 내 자전거 모델 ─────────────
  /** 모델·배터리·속도 해제 선택: 배터리 용량·무게·기본 속도·제한 속도·소모량을 함께 맞춤 */
  const applyBike = (next: Pick<EbikeSettings, "bikeModel" | "tx8BatteryAh" | "speedUnlocked">) => {
    const merged = { ...settings, ...next };
    if (next.bikeModel === "tx8pro3") {
      const model = motoveloTx8Pro3(next.speedUnlocked);
      merged.bikeKg = 26;
      merged.cruiseSpeed = next.speedUnlocked ? 28 : 20;
      merged.speedLimit = next.speedUnlocked ? 40 : 25;
      const ref = referenceLevel(model);
      updateBattery({
        ...battery,
        capacityWh: (model.batteryV ?? 48) * next.tx8BatteryAh,
        // 주행으로 학습된 소모량이 없으면 모델의 평지 기준값 사용
        whPerKm:
          battery.learned > 0
            ? battery.whPerKm
            : Math.round(flatWhPerKm(model, ref, merged.riderKg + merged.bikeKg) * 10) / 10,
      });
    }
    setSettings(merged);
  };

  // ───────────── 주차 위치 ─────────────
  const setParking = (parking: ParkingData["parking"]) => {
    const data = { parking, updatedAt: nowMs() };
    saveParking(data);
    setParkingData(data);
    autoSync();
  };

  function saveParkingHere(memo: string) {
    const store = (p: LatLng, acc: number | null) => {
      setParking({ lat: p.lat, lng: p.lng, accuracy: acc, memo, savedAt: Date.now() });
      setSavingParking(false);
      toast.success("주차 위치를 저장했습니다 🅿️");
    };
    // 주행 중이라 GPS가 켜져 있으면 그 위치를 바로 사용
    if (watchIdRef.current !== null && positionRef.current) {
      store(positionRef.current, accuracy);
      return;
    }
    setSavingParking(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => store({ lat: pos.coords.latitude, lng: pos.coords.longitude }, pos.coords.accuracy),
      () => {
        setSavingParking(false);
        toast.error("현재 위치를 찾지 못해 주차 위치를 저장하지 못했습니다.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }

  const navigateToParking = () => {
    const pk = parkingData.parking;
    if (!pk) return;
    setSheet("nav");
    // 자전거를 찾으러 가는 길이므로 걷기 경로
    chooseDestination({ name: "주차 위치", location: { lat: pk.lat, lng: pk.lng }, walk: true });
  };

  const showParking = () => {
    const pk = parkingData.parking;
    if (!pk) return;
    setSheet(null);
    setFollow(false);
    setFocus({ p: { lat: pk.lat, lng: pk.lng }, key: Date.now() });
  };

  const navigateToRideEnd = (r: RideRecord) => {
    const end = r.points[r.points.length - 1];
    if (!end) return;
    setViewing(null);
    setSheet("nav");
    chooseDestination({
      name: r.endName ?? "지난 주행 도착지",
      location: { lat: end[0], lng: end[1] },
    });
  };

  const changeProfile = (profile: RouteProfile) => {
    update("profile", profile);
    if (destination) computeRoute(destination, null, profile);
  };

  // 배터리: 누적 거리(저장된 주행 + 지금 주행) 기준 추정
  const odometer =
    rides.reduce((sum, r) => sum + r.distance, 0) + (rideStatus !== "idle" ? ride.distance : 0);
  const batteryEst = estimateBattery(battery, odometer);
  // 보조 단계별 배터리 사용량 (오르막·바람·무게 반영)
  const massKg = settings.riderKg + settings.bikeKg;
  const bikeModel = useMemo(
    () => bikeModelOf(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.bikeModel, settings.speedUnlocked],
  );
  const windOpt = useMemo(
    () => (weather ? { ms: weather.windMs, fromDeg: weather.windFromDeg } : null),
    [weather],
  );
  const routeEnergyNow = useMemo(
    () =>
      route && !route.walk
        ? routeEnergy(route.coords, route.elev ?? null, {
            massKg,
            whPerKm: battery.whPerKm,
            wind: windOpt,
            model: bikeModel,
          })
        : null,
    [route, massKg, battery.whPerKm, windOpt, bikeModel],
  );
  const candidateEnergies = useMemo(
    () =>
      candidates?.map((c) => ({
        route: c,
        energy: routeEnergy(c.coords, c.elev ?? null, {
          massKg,
          whPerKm: battery.whPerKm,
          wind: windOpt,
          model: bikeModel,
        }),
      })) ?? null,
    [candidates, massKg, battery.whPerKm, windOpt, bikeModel],
  );
  const advice =
    batteryEst && routeEnergyNow
      ? coach(routeEnergyNow, batteryEst.percent, battery.capacityWh, COACH_RESERVE)
      : null;
  useEffect(() => {
    energyRef.current = {
      whPerKm: battery.whPerKm,
      wind: windOpt,
      energy: routeEnergyNow,
      percent: batteryEst?.percent ?? null,
      capacity: battery.capacityWh,
    };
  });
  const routeBatteryLeft = advice
    ? advice.arrivePercent[referenceLevel(bikeModel).id]
    : batteryEst && route
      ? batteryEst.percent - ((route.distance / 1000) * battery.whPerKm * 100) / battery.capacityWh
      : null;
  const routeWind =
    weather && route && route.coords.length > 1
      ? headwind(weather, bearing(route.coords[0], route.coords[route.coords.length - 1]))
      : null;

  // 배터리 20% · 10% 아래로 내려가면 음성 경고 (주행 중 한 번씩)
  const lowLevel = batteryEst ? (batteryEst.percent <= 10 ? 10 : batteryEst.percent <= 20 ? 20 : null) : null;
  useEffect(() => {
    if (lowLevel === null) {
      lowBatteryRef.current = null;
      return;
    }
    if (rideStatus !== "riding" || lowBatteryRef.current === lowLevel || !batteryEst) return;
    lowBatteryRef.current = lowLevel;
    say(
      `배터리가 약 ${lowLevel}퍼센트 남았습니다. 약 ${Math.round(batteryEst.rangeKm)}킬로미터 더 갈 수 있습니다.`,
    );
  }, [lowLevel, rideStatus, batteryEst, say]);

  // 안내 시작 전 예상 시간: 지금 달리는 중이면 현재 속도, 아니면 최근 주행 평균, 없으면 기본 속도
  const recent = rides.slice(0, 10);
  const recentMoving = recent.reduce((t, r) => t + r.movingTime, 0);
  const recentAvg =
    recentMoving > 60 ? (recent.reduce((t, r) => t + r.distance, 0) / recentMoving) * 3.6 : null;
  const plan: { kmh: number; label: string } =
    speed > MOVING_KMH
      ? { kmh: speed, label: `현재 속도 ${Math.round(speed)}km/h 기준` }
      : recentAvg !== null && recentAvg > MOVING_KMH
        ? { kmh: recentAvg, label: `최근 주행 평균 ${recentAvg.toFixed(1)}km/h 기준` }
        : { kmh: settings.cruiseSpeed, label: `기본 속도 ${settings.cruiseSpeed}km/h 기준` };
  const walkPlan = route?.walk ? { kmh: WALK_KMH, label: `걷는 속도 ${WALK_KMH}km/h 기준` } : null;
  const planEtaSec = route ? route.distance / ((walkPlan ?? plan).kmh / 3.6) : 0;

  // 보조 단계 코치 문구 (안내 시작 시 음성·배너)
  const coachRecId = advice ? (advice.recommended?.id ?? "none") : "";
  const coachSpeech = advice
    ? advice.recommended
      ? `보조 단계는 ${advice.recommended.name}까지 써도 됩니다. 도착 시 배터리 약 ${Math.round(advice.arrivePercent[advice.recommended.id])}퍼센트입니다.`
      : `배터리가 부족할 수 있습니다. ${bikeModel.levels[0].name} 단계로도 약 ${(advice.shortKm ?? 0).toFixed(1)}킬로미터 부족합니다.`
    : null;
  const coachBanner = advice
    ? advice.recommended
      ? `보조 ${advice.recommended.name}까지 OK · 도착 ${Math.round(advice.arrivePercent[advice.recommended.id])}%`
      : "배터리 부족 — 가장 낮은 단계로 달리세요"
    : null;

  const startNavigation = () => {
    if (!route || !destination) return;
    unlockSpeech();
    if (destination.walk) {
      // 걸어가는 길은 주행 기록 없이 위치만 추적
      startGps();
      acquireWakeLock();
    } else if (rideStatus !== "riding") startRide();
    navRef.current.navigating = true;
    navRef.current.announced = new Map();
    navRef.current.lastCoachAt = 0;
    navRef.current.lastRec = coachRecId;
    setCoachLive(coachBanner);
    setNavigating(true);
    setFollow(true);
    setSheet(null);
    const ratio =
      route.cyclewayRatio !== null ? `, 자전거도로 비율 ${Math.round(route.cyclewayRatio * 100)}퍼센트` : "";
    const s = settingsRef.current;
    if (!s.voiceEnabled || !s.navVoice) {
      toast.warning("음성 안내가 꺼져 있습니다. 설정에서 '음성 안내 사용'과 '길 안내 음성'을 켜 주세요.");
    }
    if (s.navVoice) {
      say(
        `${destination.name}까지 ${destination.walk ? "걸어서 " : ""}길 안내를 시작합니다. ` +
          `총 ${spokenDistance(route.distance)}${ratio}, ` +
          `약 ${formatEta(planEtaSec)} 걸립니다.`,
      );
      if (coachSpeech) {
        say(coachSpeech);
      } else if (routeBatteryLeft !== null && routeBatteryLeft < 10)
        say("배터리가 부족할 수 있습니다. 충전 상태를 확인하세요.");
      if (weather && weather.rainChance >= 50)
        say(`3시간 안에 비 올 확률 ${weather.rainChance}퍼센트입니다.`);
      if (routeWind !== null && routeWind >= 4) say("맞바람이 강합니다. 평소보다 느릴 수 있습니다.");
    }
    // 시작 안내 음성 뒤에, 다음 GPS 신호를 기다리지 않고 바로 안내 배너·도착 시간 표시 (정지 중에는 아이폰이 위치를 새로 보내지 않음)
    const here = positionRef.current;
    if (here) updateNavigation(here, accuracy ?? 10);
    else {
      const first = route.maneuvers[0] ?? null;
      setProgress({
        remaining: route.distance,
        next: first,
        distToNext: first ? first.distAlong : route.distance,
        ...estimateEta(route.distance),
      });
    }
  };

  /** 안내 배너를 누르면 현재 안내를 다시 읽어줌 */
  const repeatInstruction = () => {
    if (!progress) return;
    unlockSpeech();
    const { next, distToNext } = progress;
    const eta = `약 ${formatEta(progress.etaSec)} 후 도착 예정입니다.`;
    if (!next || next.type === "arrive") {
      say(`목적지까지 ${spokenDistance(distToNext)} 남았습니다. ${eta}`, true);
    } else {
      say(
        `${aheadPhrase(distToNext, next.text)}. 목적지까지 ${spokenDistance(progress.remaining)}, ${eta}`,
        true,
      );
    }
  };

  // ───────────── 현재 위치 찾기 ─────────────
  const locateMe = useCallback(() => {
    setFollow(true);
    // 주행 중이면 GPS가 이미 켜져 있으므로 지도만 내 위치로 이동
    if (watchIdRef.current !== null && positionRef.current) return;
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        positionRef.current = p;
        setPosition(p);
        setAccuracy(pos.coords.accuracy);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 설정 > 개인정보 보호 > 위치 서비스 > Safari 웹 사이트에서 허용해 주세요."
            : "현재 위치를 찾지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }, []);

  // 안내 중에는 멈춰 있어도 5초마다 도착 시간 갱신
  useEffect(() => {
    if (!navigating) return;
    const id = setInterval(() => {
      setProgress((prev) => (prev ? { ...prev, ...estimateEta(prev.remaining) } : prev));
    }, 5000);
    return () => clearInterval(id);
  }, [navigating, estimateEta]);

  // 경로 요약의 도착 예정 시각용 현재 시각 (30초마다)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // 1분마다 낮/밤 확인 (자동 야간 지도)
  useEffect(() => {
    const tick = () => {
      const p = positionRef.current;
      setNight(isNight(new Date(), p?.lat, p?.lng));
    };
    const first = setTimeout(tick, 3000);
    const id = setInterval(tick, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // 앱을 열면 바로 현재 위치로 지도 이동 (실패해도 조용히 넘어감)
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (watchIdRef.current !== null) return; // 이미 주행 GPS가 켜짐
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        positionRef.current = p;
        setPosition(p);
        setAccuracy(pos.coords.accuracy);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }, []);

  // ───────────── 표시 값 ─────────────
  const avgSpeed = ride.movingTime > 0 ? (ride.distance / ride.movingTime) * 3.6 : 0;
  const displaySpeed = Math.round(speed);
  const mapDark = settings.mapTheme === "dark" || (settings.mapTheme === "auto" && night);
  const totalDistance =
    rides.reduce((sum, r) => sum + r.distance, 0) + (rideStatus !== "idle" ? ride.distance : 0);
  const viewingTrack = useMemo(() => viewing?.points.map(([lat, lng]) => ({ lat, lng })) ?? null, [viewing]);
  const limitRatio = Math.min(1, speed / Math.max(1, settings.speedLimit * 1.2));

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b1220] text-slate-100 select-none">
      <div className="flex min-h-0 flex-1 flex-col landscape:flex-row">
        {/* ───── 속도계 ───── */}
        <header
          className={`relative z-[1001] shrink-0 px-4 pb-3 transition-colors landscape:flex landscape:w-[40%] landscape:max-w-md landscape:flex-col landscape:justify-center landscape:overflow-y-auto ${
            bigSpeed ? "flex flex-1 flex-col justify-center landscape:w-full landscape:max-w-none" : ""
          } ${overSpeed ? "bg-red-700" : "bg-[#0b1220]"}`}
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 10px)",
            paddingLeft: "max(16px, env(safe-area-inset-left))",
          }}
        >
          <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
            <GpsBadge status={gpsStatus} accuracy={accuracy} />
            <button onClick={() => setSheet("history")} className="font-mono tabular-nums">
              누적 {(totalDistance / 1000).toFixed(1)}km
            </button>
            <button onClick={() => setSheet("battery")} className="tabular-nums">
              {batteryEst
                ? `🔋${Math.round(batteryEst.percent)}% · ${Math.round(batteryEst.rangeKm)}km`
                : "🔋 입력"}
            </button>
            {weather ? (
              <button onClick={showWeather} className="tabular-nums">
                {describeWeather(weather.code).icon}
                {Math.round(weather.tempC)}° {windName(weather.windFromDeg).replace("풍", "")}
                {Math.round(weather.windMs)}
              </button>
            ) : (
              <span>
                {rideStatus === "riding" ? "● 주행 중" : rideStatus === "paused" ? "❚❚ 일시정지" : "대기"}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-end justify-center gap-2">
            <span
              className={`font-mono font-bold leading-none tabular-nums ${
                bigSpeed ? "text-[length:min(42vw,34vh)]" : "text-[88px] landscape:text-[72px]"
              }`}
            >
              {displaySpeed}
            </span>
            <span className={`text-slate-300 ${bigSpeed ? "mb-6 text-3xl" : "mb-3 text-xl"}`}>km/h</span>
          </div>
          <div className="mx-auto mt-2 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${speed > settings.speedLimit ? "bg-red-400" : "bg-emerald-400"}`}
              style={{ width: `${limitRatio * 100}%` }}
            />
          </div>
          <div className="mx-auto mt-3 grid w-full max-w-md grid-cols-4 gap-1 text-center">
            <Stat label="거리" value={formatDistance(ride.distance)} />
            <Stat label="시간" value={formatDuration(ride.elapsed)} />
            <Stat label="평균" value={`${avgSpeed.toFixed(1)}`} />
            <Stat label="최고" value={`${ride.maxSpeed.toFixed(1)}`} />
          </div>
          {bigSpeed && navigating && progress && (
            <div className="mx-auto mt-4 w-full max-w-md">
              <NavBanner
                progress={progress}
                coachText={coachLive}
                onRepeat={repeatInstruction}
                onStop={stopNavigation}
              />
            </div>
          )}
          {bigSpeed && (
            <button
              onClick={() => setBigSpeed(false)}
              className="mx-auto mt-4 rounded-xl bg-slate-800 px-5 py-3 text-base"
            >
              🗺 지도 보기
            </button>
          )}
        </header>

        {/* ───── 지도 ───── */}
        <main className={`relative min-h-0 flex-1 ${bigSpeed ? "hidden" : ""}`}>
          <MapView
            position={position}
            heading={heading}
            accuracy={accuracy}
            route={route}
            destination={destination?.location ?? null}
            track={viewingTrack}
            parking={parkingData.parking}
            focus={focus}
            follow={follow}
            cycleLayer={settings.cycleLayer}
            dark={mapDark}
            headingUp={settings.headingUp}
            hidden={bigSpeed}
            pickMode={pickMode}
            onPick={onPick}
            onUserPan={() => {
              setFollow(false);
              setMenuOpen(false);
            }}
          />

          {navigating && progress && (
            <div className="absolute inset-x-3 top-3 z-[1000]">
              <NavBanner
                progress={progress}
                coachText={coachLive}
                onRepeat={repeatInstruction}
                onStop={stopNavigation}
              />
            </div>
          )}

          {viewing && !navigating && !pickMode && (
            <div className="absolute inset-x-3 top-3 z-[1000] flex items-center justify-between gap-2 rounded-2xl bg-violet-700/95 p-3 text-sm shadow-lg">
              <div className="min-w-0">
                <div className="font-semibold">
                  지난 주행 · {new Date(viewing.startedAt).toLocaleDateString("ko-KR")}
                </div>
                <div className="truncate text-xs text-violet-100">
                  {formatDistance(viewing.distance)} · {formatDuration(viewing.elapsed)}
                  {viewing.startName && viewing.endName && ` · ${viewing.startName} → ${viewing.endName}`}
                </div>
              </div>
              <button onClick={() => setViewing(null)} className="shrink-0 rounded-lg bg-black/30 px-3 py-1">
                닫기
              </button>
            </div>
          )}

          {pickMode && (
            <div className="absolute inset-x-3 top-3 z-[1000] flex items-center justify-between rounded-2xl bg-blue-700/95 p-3 text-sm shadow-lg">
              <span>지도를 탭해서 목적지를 선택하세요</span>
              <button onClick={() => setPickMode(false)} className="rounded-lg bg-black/30 px-3 py-1">
                취소
              </button>
            </div>
          )}

          {/* 방향 모드: 북쪽 위 ↔ 진행 방향 위 */}
          <div className="absolute bottom-3 left-3 z-[1000]">
            <MapButton
              active={settings.headingUp}
              onClick={() => {
                update("headingUp", !settings.headingUp);
                toast.info(
                  settings.headingUp ? "북쪽이 위로 고정됩니다" : "진행 방향이 위로 오도록 지도가 회전합니다",
                );
              }}
              label={settings.headingUp ? "진행 방향 위 (누르면 북쪽 위)" : "북쪽 위 (누르면 진행 방향 위)"}
            >
              <svg
                viewBox="0 0 24 24"
                className="mx-auto h-8 w-8 transition-transform"
                style={{ transform: `rotate(${settings.headingUp && heading !== null ? -heading : 0}deg)` }}
                aria-hidden
              >
                <path d="M12 2 17 13H7z" fill="#ef4444" />
                <path d="M12 22 7 13h10z" fill="currentColor" opacity=".5" />
                <text x="12" y="11" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff">
                  N
                </text>
              </svg>
            </MapButton>
          </div>

          <div className="absolute bottom-3 right-3 z-[1000] flex flex-col items-end gap-3">
            {menuOpen && (
              <div className="absolute bottom-0 right-[68px] w-60 space-y-1 rounded-2xl bg-slate-900/95 p-2 text-sm shadow-xl">
                <MenuItem
                  icon="🚲"
                  label="자전거도로 지도"
                  value={settings.cycleLayer ? "켜짐" : "꺼짐"}
                  onClick={() => update("cycleLayer", !settings.cycleLayer)}
                />
                <MenuItem
                  icon={mapDark ? "🌙" : "☀️"}
                  label="지도 밝기"
                  value={THEME_LABEL[settings.mapTheme]}
                  onClick={() => update("mapTheme", NEXT_THEME[settings.mapTheme])}
                />
                <MenuItem
                  icon="🔢"
                  label="속도계 크게 보기"
                  onClick={() => {
                    setBigSpeed(true);
                    setMenuOpen(false);
                  }}
                />
                <MenuItem
                  icon="🆘"
                  label="긴급 SOS"
                  onClick={() => {
                    openSos("sos");
                    setMenuOpen(false);
                  }}
                />
                <MenuItem
                  icon="ℹ︎"
                  label="내 위치 정보"
                  onClick={() => {
                    setSheet("location");
                    setMenuOpen(false);
                  }}
                />
              </div>
            )}
            <MapButton active={menuOpen} onClick={() => setMenuOpen(!menuOpen)} label="지도 메뉴">
              ☰
            </MapButton>
            <MapButton active={!!parkingData.parking} onClick={() => setSheet("parking")} label="주차 위치">
              🅿️
            </MapButton>
            <MapButton active={follow} onClick={() => locateMe()} label="현재 위치 찾기">
              <svg
                viewBox="0 0 24 24"
                className={`mx-auto h-7 w-7 ${locating ? "animate-pulse" : ""}`}
                fill="currentColor"
                aria-hidden
              >
                <path d="M21 3 3 10.5l7.2 2.3L12.5 20z" />
              </svg>
            </MapButton>
          </div>
        </main>
      </div>

      {/* ───── 하단 조작 ───── */}
      <footer
        className="relative z-[1001] shrink-0 bg-[#0b1220] px-3 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
      >
        <div className="mx-auto flex max-w-md gap-2">
          {rideStatus === "riding" ? (
            <BigButton className="bg-amber-500 text-black" onClick={pauseRide}>
              일시정지
            </BigButton>
          ) : (
            <BigButton className="bg-emerald-500 text-black" onClick={startRide}>
              {rideStatus === "paused" ? "계속" : "주행 시작"}
            </BigButton>
          )}
          {rideStatus !== "idle" && (
            <BigButton className="bg-slate-700" onClick={endRide}>
              종료
            </BigButton>
          )}
          <BigButton className="bg-blue-600" onClick={() => setSheet(sheet === "nav" ? null : "nav")}>
            길찾기
          </BigButton>
          <BigButton
            className="bg-violet-600"
            onClick={() => setSheet(sheet === "history" ? null : "history")}
          >
            기록
          </BigButton>
          <BigButton
            className="max-w-14 bg-slate-700"
            onClick={() => setSheet(sheet === "settings" ? null : "settings")}
            aria-label="설정"
          >
            ⚙︎
          </BigButton>
        </div>
      </footer>

      {/* ───── 길찾기 시트 ───── */}
      {sheet === "nav" && (
        <Sheet title="자전거 길찾기" onClose={() => setSheet(null)}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              doSearch();
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="목적지 검색 (예: 여의도 한강공원)"
              enterKeyHint="search"
              className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-3 text-base outline-none ring-blue-500 focus:ring-2"
            />
            <button className="rounded-xl bg-blue-600 px-4 font-semibold" disabled={searching}>
              {searching ? "…" : "검색"}
            </button>
          </form>
          <button
            onClick={() => {
              setPickMode(true);
              setSheet(null);
              setFollow(false);
            }}
            className="mt-2 w-full rounded-xl bg-slate-800 py-2 text-sm text-slate-300"
          >
            📍 지도에서 목적지 선택
          </button>

          <div className="mt-3 text-xs text-slate-400">주변 찾기 (가까운 순)</div>
          <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
            {NEARBY_KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => findNearby(k)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                  nearbyKind === k.id && results.length > 0 ? "bg-blue-700" : "bg-slate-800"
                }`}
              >
                {k.icon} {k.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => goToPlace(places.home, "집")}
              className={`shrink-0 rounded-full px-4 py-2 text-sm ${places.home ? "bg-emerald-700" : "bg-slate-800 text-slate-400"}`}
            >
              🏠 집
            </button>
            <button
              onClick={() => goToPlace(places.work, "회사")}
              className={`shrink-0 rounded-full px-4 py-2 text-sm ${places.work ? "bg-emerald-700" : "bg-slate-800 text-slate-400"}`}
            >
              🏢 회사
            </button>
            {parkingData.parking && (
              <button
                onClick={navigateToParking}
                className="shrink-0 rounded-full bg-blue-700 px-4 py-2 text-sm"
              >
                🅿️ 주차 위치
              </button>
            )}
            {places.favorites.map((f) => (
              <span key={f.id} className="flex shrink-0 items-center rounded-full bg-slate-800 text-sm">
                <button onClick={() => goToPlace(f, f.name)} className="py-2 pl-4 pr-1">
                  ⭐ {f.name}
                </button>
                <button
                  onClick={() => removeFavorite(f)}
                  className="px-2 py-2 text-slate-500"
                  aria-label={`${f.name} 즐겨찾기 삭제`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          {results.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-800/60">
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    className="w-full px-3 py-2 text-left"
                    onClick={() => chooseDestination({ name: r.name, location: r.location })}
                  >
                    <div className="font-medium">{r.name}</div>
                    <div className="truncate text-xs text-slate-400">
                      {r.detail}
                      {r.distance != null
                        ? ` · ${formatDistance(r.distance)}`
                        : position && ` · 직선 ${formatDistance(haversine(position, r.location))}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 text-sm text-slate-400">
            경로 옵션{destination?.walk && " · 🚶 주차 위치까지는 걷기 경로로 안내합니다"}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(Object.keys(PROFILE_LABELS) as RouteProfile[]).map((p) => (
              <button
                key={p}
                onClick={() => changeProfile(p)}
                className={`rounded-xl px-2 py-2 text-sm ${
                  settings.profile === p ? "bg-emerald-600 font-semibold" : "bg-slate-800 text-slate-300"
                }`}
              >
                {PROFILE_LABELS[p].name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{PROFILE_LABELS[settings.profile].desc}</p>

          {destination && (
            <div className="mt-4 rounded-xl bg-slate-800/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-slate-400">목적지</div>
                  <div className="truncate font-semibold">{destination.name}</div>
                </div>
                <button onClick={clearDestination} className="text-sm text-slate-400">
                  지우기
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <button onClick={() => saveFavorite("home")} className="rounded-lg bg-slate-700 py-1.5">
                  🏠 집으로 저장
                </button>
                <button onClick={() => saveFavorite("work")} className="rounded-lg bg-slate-700 py-1.5">
                  🏢 회사로 저장
                </button>
                <button onClick={() => saveFavorite("fav")} className="rounded-lg bg-slate-700 py-1.5">
                  ⭐ 즐겨찾기
                </button>
              </div>
              {routing && <div className="mt-2 text-sm text-slate-300">경로 탐색 중…</div>}
              {!routing && route && (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <Stat label="거리" value={formatDistance(route.distance)} />
                    <Stat
                      label={`도착 ${formatClock(now + planEtaSec * 1000)}`}
                      value={formatEta(planEtaSec)}
                    />
                    <Stat
                      label="자전거도로"
                      value={route.cyclewayRatio === null ? "-" : `${Math.round(route.cyclewayRatio * 100)}%`}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {route.walk ? "🚶 걷기 · " : ""}
                    {route.source === "kakao"
                      ? "카카오맵"
                      : route.source === "brouter"
                        ? "BRouter"
                        : "OSRM"}{" "}
                    경로 · 예상 시간은 {(walkPlan ?? plan).label}, 안내 중에는 현재 속도로 실시간 계산
                  </div>
                  {routeEnergyNow && (
                    <CoachPanel
                      candidates={settings.profile === "battery" ? candidateEnergies : null}
                      selected={route}
                      onSelect={(r) => {
                        navRef.current.route = r;
                        navRef.current.announced = new Map();
                        navRef.current.lastCoachAt = 0;
                        setRoute(r);
                      }}
                      energy={routeEnergyNow}
                      advice={advice}
                      capacityWh={battery.capacityWh}
                      onOpenBattery={() => setSheet("battery")}
                    />
                  )}
                  {route.landingUrl && (
                    <a
                      href={route.landingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-yellow-300 underline"
                    >
                      카카오맵에서 이 경로 열기 ↗
                    </a>
                  )}
                  <ul className="mt-2 space-y-1 text-xs">
                    {routeBatteryLeft !== null && !route.walk && (
                      <li className={routeBatteryLeft < 10 ? "text-red-300" : "text-slate-300"}>
                        🔋 도착 시 예상 배터리 {Math.max(0, Math.round(routeBatteryLeft))}%
                        {routeBatteryLeft < 10 && " — 부족할 수 있어요"}
                      </li>
                    )}
                    {weather && routeWind !== null && (
                      <li className={routeWind >= 4 ? "text-amber-300" : "text-slate-300"}>
                        🌬 {windEffectText(routeWind, weather.windMs)}
                      </li>
                    )}
                    {weather && weather.rainChance >= 30 && (
                      <li className={weather.rainChance >= 50 ? "text-amber-300" : "text-slate-300"}>
                        ☔ 3시간 안에 비 올 확률 {weather.rainChance}%
                      </li>
                    )}
                  </ul>
                  <button
                    onClick={startNavigation}
                    className="mt-3 w-full rounded-xl bg-emerald-500 py-3 text-lg font-bold text-black"
                  >
                    {navigating ? "안내 중" : "안내 시작"}
                  </button>
                </>
              )}
            </div>
          )}
        </Sheet>
      )}

      {/* ───── 처음 사용 안내 ───── */}
      {onboarding && (
        <Onboarding
          onDone={() => {
            markOnboarded();
            setOnboarding(false);
          }}
          onOpenBattery={() => {
            markOnboarded();
            setOnboarding(false);
            setSheet("battery");
          }}
          onOpenSettings={() => {
            markOnboarded();
            setOnboarding(false);
            setSheet("settings");
          }}
        />
      )}

      {/* ───── 배터리 시트 ───── */}
      {sheet === "battery" && (
        <BatterySheet
          battery={battery}
          odometer={odometer}
          onSetPercent={(pct) => {
            const next = recordPercent(battery, pct, odometer);
            updateBattery(next);
            toast.success(
              next.learned > battery.learned
                ? `배터리 ${pct}% 저장 · 소모량 ${next.whPerKm}Wh/km로 학습했습니다`
                : `배터리 ${pct}% 저장`,
            );
            setSheet(null);
          }}
          onChange={updateBattery}
          onClose={() => setSheet(null)}
        />
      )}

      {/* ───── 넘어짐 확인 · 긴급 ───── */}
      {sos && (
        <SosOverlay
          mode={sos}
          position={position}
          address={sosAddress}
          contactName={settings.emergencyName}
          contactPhone={settings.emergencyPhone}
          say={sayUrgent}
          onOk={() => {
            setSos(null);
            crashRef.current?.reset();
            say("다행입니다. 안전 운전하세요.", true);
          }}
          onSos={openSosScreen}
          onClose={() => {
            setSos(null);
            crashRef.current?.reset();
          }}
        />
      )}

      {/* ───── 기록 시트 ───── */}
      {sheet === "history" && (
        <HistorySheet
          rides={rides}
          currentDistance={rideStatus !== "idle" ? ride.distance : 0}
          onClose={() => setSheet(null)}
          onView={viewRide}
          onExport={exportRide}
          onNavigate={navigateToRideEnd}
          onDelete={removeRide}
        />
      )}

      {/* ───── 주차 위치 시트 ───── */}
      {sheet === "parking" && (
        <ParkingSheet
          parking={parkingData.parking}
          position={position}
          saving={savingParking}
          onSave={saveParkingHere}
          onClear={() => setParking(null)}
          onNavigate={navigateToParking}
          onShow={showParking}
          onClose={() => setSheet(null)}
        />
      )}

      {/* ───── 위치 정보 시트 ───── */}
      {sheet === "location" && (
        <LocationSheet
          position={gpsStatus === "on" ? position : null}
          accuracy={accuracy}
          onClose={() => setSheet(null)}
        />
      )}

      {/* ───── 설정 시트 ───── */}
      {sheet === "settings" && (
        <Sheet title="설정" onClose={() => setSheet(null)}>
          <Section title="음성 안내">
            <Toggle
              label="음성 안내 사용"
              value={settings.voiceEnabled}
              onChange={(v) => update("voiceEnabled", v)}
            />
            {!isSpeechSupported() && (
              <p className="text-xs text-red-400">이 브라우저는 음성 합성을 지원하지 않습니다.</p>
            )}
            <Toggle label="길 안내 음성" value={settings.navVoice} onChange={(v) => update("navVoice", v)} />
            <Row label="주기적 속도 안내">
              <select
                value={settings.periodicMode}
                onChange={(e) => update("periodicMode", e.target.value as EbikeSettings["periodicMode"])}
                className="rounded-lg bg-slate-800 px-2 py-1"
              >
                <option value="off">끄기</option>
                <option value="time">시간마다</option>
                <option value="distance">거리마다</option>
              </select>
            </Row>
            {settings.periodicMode === "time" && (
              <Row label="안내 간격">
                <select
                  value={settings.periodicMinutes}
                  onChange={(e) => update("periodicMinutes", Number(e.target.value))}
                  className="rounded-lg bg-slate-800 px-2 py-1"
                >
                  {[1, 3, 5, 10, 15, 30].map((m) => (
                    <option key={m} value={m}>
                      {m}분
                    </option>
                  ))}
                </select>
              </Row>
            )}
            {settings.periodicMode === "distance" && (
              <Row label="안내 간격">
                <select
                  value={settings.periodicKm}
                  onChange={(e) => update("periodicKm", Number(e.target.value))}
                  className="rounded-lg bg-slate-800 px-2 py-1"
                >
                  {[0.5, 1, 2, 5, 10].map((k) => (
                    <option key={k} value={k}>
                      {k}km
                    </option>
                  ))}
                </select>
              </Row>
            )}
            {voices.length > 0 && (
              <Row label="목소리">
                <select
                  value={settings.voiceURI ?? ""}
                  onChange={(e) => update("voiceURI", e.target.value || null)}
                  className="max-w-44 rounded-lg bg-slate-800 px-2 py-1"
                >
                  <option value="">기본</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            <Slider
              label="말하기 속도"
              min={0.6}
              max={1.6}
              step={0.1}
              value={settings.rate}
              onChange={(v) => update("rate", v)}
            />
            <Slider
              label="음량"
              min={0.2}
              max={1}
              step={0.1}
              value={settings.volume}
              onChange={(v) => update("volume", v)}
            />
            <button
              onClick={() => {
                unlockSpeech();
                say(`현재 시속 ${displaySpeed}킬로미터입니다.`, true);
              }}
              className="w-full rounded-xl bg-slate-800 py-2 text-sm"
            >
              🔊 음성 테스트
            </button>
          </Section>

          <Section title="내 자전거">
            <Row label="모델">
              <select
                value={settings.bikeModel}
                onChange={(e) =>
                  applyBike({
                    bikeModel: e.target.value as EbikeSettings["bikeModel"],
                    tx8BatteryAh: settings.tx8BatteryAh,
                    speedUnlocked: settings.speedUnlocked,
                  })
                }
                className="rounded-lg bg-slate-800 px-2 py-1"
              >
                <option value="custom">직접 입력</option>
                <option value="tx8pro3">모토벨로 TX8 PRO3</option>
              </select>
            </Row>
            {settings.bikeModel === "tx8pro3" && (
              <>
                <Row label="배터리 (48V)">
                  <select
                    value={settings.tx8BatteryAh}
                    onChange={(e) =>
                      applyBike({
                        bikeModel: "tx8pro3",
                        tx8BatteryAh: Number(e.target.value) as 15 | 20,
                        speedUnlocked: settings.speedUnlocked,
                      })
                    }
                    className="rounded-lg bg-slate-800 px-2 py-1"
                  >
                    <option value={15}>15Ah (720Wh)</option>
                    <option value={20}>20Ah (960Wh)</option>
                  </select>
                </Row>
                <Toggle
                  label="속도 제한 해제 버전"
                  value={settings.speedUnlocked}
                  onChange={(v) =>
                    applyBike({ bikeModel: "tx8pro3", tx8BatteryAh: settings.tx8BatteryAh, speedUnlocked: v })
                  }
                />
                <p className="text-xs text-slate-400">
                  500W 모터 · 20×2.4 팻타이어 · 25.8kg · PAS 3단 + 스로틀 기준으로 계산합니다.
                </p>
              </>
            )}
            <Slider
              label={`내 몸무게 ${settings.riderKg}kg`}
              min={30}
              max={140}
              step={1}
              value={settings.riderKg}
              onChange={(v) => update("riderKg", v)}
            />
            <Slider
              label={`자전거 무게 ${settings.bikeKg}kg (짐 포함)`}
              min={12}
              max={60}
              step={1}
              value={settings.bikeKg}
              onChange={(v) => update("bikeKg", v)}
            />
            <div>
              <div className="mb-1 text-xs text-slate-400">
                완충 시 평지 주행 가능 거리 (배터리 {battery.capacityWh}Wh · 무풍)
              </div>
              <div className="grid grid-cols-4 gap-1 text-center">
                {bikeModel.levels.map((l) => {
                  const scale = battery.whPerKm / flatWhPerKm(bikeModel, referenceLevel(bikeModel), massKg);
                  const km = battery.capacityWh / (flatWhPerKm(bikeModel, l, massKg) * scale);
                  return <Stat key={l.id} label={`${l.name} · ${l.kmh}km/h`} value={`${Math.round(km)}km`} />;
                })}
              </div>
            </div>
          </Section>

          <Section title="속도">
            <Toggle
              label="속도 초과 경고"
              value={settings.speedWarn}
              onChange={(v) => update("speedWarn", v)}
            />
            <Slider
              label={`제한 속도 ${settings.speedLimit}km/h`}
              min={10}
              max={45}
              step={1}
              value={settings.speedLimit}
              onChange={(v) => update("speedLimit", v)}
            />
            <Slider
              label={`기본 속도 ${settings.cruiseSpeed}km/h (주행 기록이 없을 때 도착 시간 계산)`}
              min={10}
              max={35}
              step={1}
              value={settings.cruiseSpeed}
              onChange={(v) => update("cruiseSpeed", v)}
            />
          </Section>

          <Section title="안전">
            <Toggle
              label="넘어짐 감지 (충격 후 멈추면 확인)"
              value={settings.crashDetect}
              onChange={(v) => update("crashDetect", v)}
            />
            <Row label="보호자 이름">
              <input
                value={settings.emergencyName}
                onChange={(e) => update("emergencyName", e.target.value)}
                placeholder="예: 엄마"
                className="w-40 rounded-lg bg-slate-900 px-2 py-1.5 text-right"
              />
            </Row>
            <Row label="보호자 전화번호">
              <input
                value={settings.emergencyPhone}
                onChange={(e) => update("emergencyPhone", e.target.value)}
                placeholder="010-0000-0000"
                inputMode="tel"
                className="w-40 rounded-lg bg-slate-900 px-2 py-1.5 text-right"
              />
            </Row>
            <button onClick={() => openSos("check")} className="w-full rounded-xl bg-slate-800 py-2 text-sm">
              넘어짐 알림 미리보기
            </button>
            <p className="text-xs text-slate-500">
              주행 중 강한 충격 뒤 10초 이상 멈춰 있으면 “괜찮으세요?”를 묻고, 30초 동안 응답이 없으면
              119·보호자 연락 화면을 엽니다. 웹앱은 문자를 자동으로 보낼 수 없어 버튼을 한 번 눌러야 합니다.
            </p>
          </Section>

          <SyncSection code={syncCode} onCodeChange={setSyncCode} onDataChanged={reloadLocalData} />

          <Section title="화면">
            <Toggle
              label="주행 중 화면 켜짐 유지"
              value={settings.keepAwake}
              onChange={(v) => update("keepAwake", v)}
            />
            <Toggle
              label="자전거도로 지도 표시"
              value={settings.cycleLayer}
              onChange={(v) => update("cycleLayer", v)}
            />
            <Toggle
              label="진행 방향이 위로 (지도 회전)"
              value={settings.headingUp}
              onChange={(v) => update("headingUp", v)}
            />
            <Row label="지도 밝기">
              <select
                value={settings.mapTheme}
                onChange={(e) => update("mapTheme", e.target.value as EbikeSettings["mapTheme"])}
                className="rounded-lg bg-slate-800 px-2 py-1"
              >
                <option value="auto">자동 (일몰 후 어둡게)</option>
                <option value="light">밝게</option>
                <option value="dark">어둡게</option>
              </select>
            </Row>
          </Section>

          <button
            onClick={() => {
              setSheet(null);
              setOnboarding(true);
            }}
            className="mt-2 w-full rounded-xl bg-slate-800 py-2 text-sm"
          >
            📖 사용 안내 다시 보기
          </button>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            아이폰 사용 팁: Safari 공유 버튼 → “홈 화면에 추가”로 앱처럼 쓸 수 있습니다. 웹앱 특성상 화면이
            꺼지거나 다른 앱으로 전환하면 위치 추적과 음성 안내가 멈추므로, 핸들 거치대에 두고 화면을 켠
            상태로 사용하세요. 지도 © OpenStreetMap 기여자, 경로 BRouter/OSRM.
          </p>
        </Sheet>
      )}
    </div>
  );
}

/** 길 안내 배너 (지도 위 / 속도계 크게 보기 공용) */
function NavBanner({
  progress,
  coachText,
  onRepeat,
  onStop,
}: {
  progress: NavProgress;
  coachText?: string | null;
  onRepeat: () => void;
  onStop: () => void;
}) {
  const { next, distToNext } = progress;
  // 회전 지점 300m 전부터 가까워질수록 차오르는 막대
  const showBar = !!next && next.type !== "arrive" && distToNext <= 300;
  const fill = showBar ? Math.min(1, Math.max(0, (300 - distToNext) / 300)) : 0;
  return (
    <div className="overflow-hidden rounded-2xl bg-emerald-700/95 shadow-lg">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={onRepeat}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label="안내 다시 듣기"
        >
          <div className="w-14 text-center text-5xl leading-none">{TURN_ICON[next?.type ?? "straight"]}</div>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold">{formatDistance(distToNext)}</div>
            <div className="truncate text-base">{next?.text ?? "직진"}</div>
            <div className="text-xs text-emerald-100">
              남은 {formatDistance(progress.remaining)} · {formatEta(progress.etaSec)} 후 도착 (
              {formatClock(progress.arriveAt)})
            </div>
            <div className="text-[11px] text-emerald-200/80">
              {progress.etaBasis === "current"
                ? `현재 속도 ${Math.round(progress.etaKmh)}km/h 기준`
                : progress.etaBasis === "average"
                  ? `정지 중 · 평균 ${progress.etaKmh.toFixed(1)}km/h 기준`
                  : `기본 속도 ${Math.round(progress.etaKmh)}km/h 기준`}{" "}
              · 🔊 다시 듣기
            </div>
            {coachText && <div className="mt-0.5 text-xs font-semibold text-yellow-200">🔋 {coachText}</div>}
          </div>
        </button>
        <button
          onClick={onStop}
          className="rounded-xl bg-black/30 px-3 py-2 text-sm"
          aria-label="길 안내 종료"
        >
          종료
        </button>
      </div>
      {showBar && (
        <div className="h-2 bg-black/30" role="progressbar" aria-label="회전 지점까지 남은 거리">
          <div
            className={`h-full transition-[width] duration-700 ${distToNext <= 60 ? "bg-yellow-300" : "bg-white"}`}
            style={{ width: `${fill * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  value,
  onClick,
}: {
  icon: string;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-slate-700"
    >
      <span className="w-6 text-center text-lg">{icon}</span>
      <span className="flex-1">{label}</span>
      {value && <span className="text-xs text-emerald-400">{value}</span>}
    </button>
  );
}

/** "250미터 앞에서 좌회전" / 카카오 문구에 이미 "~에서"가 있으면 "250미터 앞, 잠실사거리에서 좌회전" */
function aheadPhrase(dist: number, text: string): string {
  return /에서/.test(text) ? `${spokenDistance(dist)} 앞, ${text}` : `${spokenDistance(dist)} 앞에서 ${text}`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

// ───────────── UI 조각 ─────────────

function GpsBadge({ status, accuracy }: { status: GpsStatus; accuracy: number | null }) {
  const map: Record<GpsStatus, [string, string]> = {
    off: ["bg-slate-500", "GPS 꺼짐"],
    waiting: ["bg-amber-400 animate-pulse", "GPS 수신 중"],
    on: [accuracy !== null && accuracy > MAX_ACCURACY ? "bg-amber-400" : "bg-emerald-400", "GPS"],
    error: ["bg-red-500", "GPS 오류"],
  };
  const [color, label] = map[status];
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
      {status === "on" && accuracy !== null && ` ±${Math.round(accuracy)}m`}
    </span>
  );
}
