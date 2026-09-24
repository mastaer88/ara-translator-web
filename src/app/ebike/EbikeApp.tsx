"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  formatDistance,
  formatDuration,
  formatEta,
  haversine,
  projectOnRoute,
  spokenDistance,
  type LatLng,
} from "@/lib/ebike/geo";
import {
  PROFILE_LABELS,
  findBikeRoute,
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
import { loadSyncCode, syncNow } from "@/lib/ebike/sync";
import { getKoreanVoices, isSpeechSupported, speak, unlockSpeech } from "@/lib/ebike/voice";
import { loadSettings, saveSettings, type EbikeSettings } from "./settings";
import HistorySheet from "./HistorySheet";
import ParkingSheet from "./ParkingSheet";
import SyncSection from "./SyncSection";
import LocationSheet from "./LocationSheet";
import { BigButton, MapButton, Row, Section, Sheet, Slider, Stat, Toggle } from "./ui";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type RideStatus = "idle" | "riding" | "paused";
type GpsStatus = "off" | "waiting" | "on" | "error";
type Destination = { name: string; location: LatLng };
type NavProgress = {
  remaining: number;
  next: Maneuver | null;
  distToNext: number;
};

/** 정확도가 이보다 나쁜 위치는 거리 누적에서 제외 (m) */
const MAX_ACCURACY = 35;
/** 경로 이탈 판정 거리 (m) */
const OFF_ROUTE_DIST = 45;
/** 도착 판정 거리 (m) */
const ARRIVE_DIST = 25;

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
    offCount: 0,
    lastReroute: 0,
    rerouting: false,
  });

  // 화면
  const [sheet, setSheet] = useState<"nav" | "settings" | "history" | "location" | "parking" | null>(null);
  const [places, setPlaces] = useState<PlacesData>(loadPlaces);
  const [parkingData, setParkingData] = useState<ParkingData>(loadParking);
  const [savingParking, setSavingParking] = useState(false);
  const [focus, setFocus] = useState<{ p: LatLng; key: number } | null>(null);
  const [syncCode, setSyncCode] = useState<string | null>(loadSyncCode);
  const syncCodeRef = useRef(syncCode);
  const syncingRef = useRef(false);
  const [follow, setFollow] = useState(true);
  const [locating, setLocating] = useState(false);
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
        const r = await findBikeRoute(origin, dest.location, profile ?? settingsRef.current.profile);
        navRef.current.route = r;
        navRef.current.announced = new Map();
        navRef.current.offCount = 0;
        setRoute(r);
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
      setProgress({ remaining, next, distToNext });

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
        say(`${spokenDistance(distToNext)} 앞에서 ${next.text}`);
      } else if (distToNext > 400 && !stages.has("straight")) {
        // 회전 직후 다음 안내까지 멀면 직진 거리를 알려줌
        stages.add("straight");
        say(`${spokenDistance(distToNext)} 직진 후 ${next.text}`);
      }
    },
    [computeRoute, say, stopNavigation],
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

      setSpeed((prev) => (kmh === 0 ? 0 : prev * 0.3 + kmh * 0.7));
      setPosition(p);
      setAccuracy(acc);
      if (rawHeading !== null && !Number.isNaN(rawHeading) && kmh > 3) setHeading(rawHeading);
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
          track.push([
            Math.round(p.lat * 1e6) / 1e6,
            Math.round(p.lng * 1e6) / 1e6,
            Math.round((t - startedAtRef.current) / 1000),
            Math.round(kmh * 10) / 10,
          ]);
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

  // ───────────── 주행 제어 ─────────────
  const setRideStatusBoth = (s: RideStatus) => {
    rideStatusRef.current = s;
    setRideStatus(s);
  };

  const startRide = () => {
    unlockSpeech(); // iOS: 터치 이벤트 안에서 음성 활성화
    startGps();
    acquireWakeLock();
    if (rideStatus === "idle") {
      rideRef.current = { ...EMPTY_RIDE };
      periodicRef.current = { lastTime: 0, lastDistance: 0 };
      trackRef.current = [];
      startedAtRef.current = Date.now();
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

  // ───────────── 주차 위치 ─────────────
  const setParking = (parking: ParkingData["parking"]) => {
    const data = { parking, updatedAt: Date.now() };
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
    chooseDestination({ name: "주차 위치", location: { lat: pk.lat, lng: pk.lng } });
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

  const startNavigation = () => {
    if (!route || !destination) return;
    unlockSpeech();
    if (rideStatus !== "riding") startRide();
    navRef.current.navigating = true;
    navRef.current.announced = new Map();
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
        `${destination.name}까지 길 안내를 시작합니다. 총 ${spokenDistance(route.distance)}${ratio}입니다.`,
      );
    }
  };

  /** 안내 배너를 누르면 현재 안내를 다시 읽어줌 */
  const repeatInstruction = () => {
    if (!progress) return;
    unlockSpeech();
    const { next, distToNext } = progress;
    if (!next || next.type === "arrive") {
      say(`목적지까지 ${spokenDistance(distToNext)} 남았습니다.`, true);
    } else {
      say(
        `${spokenDistance(distToNext)} 앞에서 ${next.text}. 목적지까지 ${spokenDistance(progress.remaining)}`,
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
  const cruiseMs = (settings.cruiseSpeed * 1000) / 3600;
  const displaySpeed = Math.round(speed);
  const totalDistance =
    rides.reduce((sum, r) => sum + r.distance, 0) + (rideStatus !== "idle" ? ride.distance : 0);
  const viewingTrack = useMemo(() => viewing?.points.map(([lat, lng]) => ({ lat, lng })) ?? null, [viewing]);
  const limitRatio = Math.min(1, speed / Math.max(1, settings.speedLimit * 1.2));

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b1220] text-slate-100 select-none">
      {/* ───── 속도계 ───── */}
      <header
        className={`relative z-[1001] shrink-0 px-4 pb-3 transition-colors ${
          overSpeed ? "bg-red-700" : "bg-[#0b1220]"
        }`}
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}
      >
        <div className="flex items-center justify-between text-xs text-slate-300">
          <GpsBadge status={gpsStatus} accuracy={accuracy} />
          <button onClick={() => setSheet("history")} className="font-mono tabular-nums">
            누적 {(totalDistance / 1000).toFixed(1)}km
          </button>
          <span>
            {rideStatus === "riding" ? "● 주행 중" : rideStatus === "paused" ? "❚❚ 일시정지" : "대기"}
          </span>
        </div>
        <div className="mt-1 flex items-end justify-center gap-2">
          <span className="font-mono text-[88px] font-bold leading-none tabular-nums">{displaySpeed}</span>
          <span className="mb-3 text-xl text-slate-300">km/h</span>
        </div>
        <div className="mx-auto mt-2 h-2 max-w-md overflow-hidden rounded-full bg-slate-700">
          <div
            className={`h-full rounded-full ${speed > settings.speedLimit ? "bg-red-400" : "bg-emerald-400"}`}
            style={{ width: `${limitRatio * 100}%` }}
          />
        </div>
        <div className="mx-auto mt-3 grid max-w-md grid-cols-4 gap-1 text-center">
          <Stat label="거리" value={formatDistance(ride.distance)} />
          <Stat label="시간" value={formatDuration(ride.elapsed)} />
          <Stat label="평균" value={`${avgSpeed.toFixed(1)}`} />
          <Stat label="최고" value={`${ride.maxSpeed.toFixed(1)}`} />
        </div>
      </header>

      {/* ───── 지도 ───── */}
      <main className="relative min-h-0 flex-1">
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
          pickMode={pickMode}
          onPick={onPick}
          onUserPan={() => setFollow(false)}
        />

        {navigating && progress && (
          <div className="absolute inset-x-3 top-3 z-[1000] flex items-center gap-3 rounded-2xl bg-emerald-700/95 p-3 shadow-lg">
            <button
              onClick={repeatInstruction}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              aria-label="안내 다시 듣기"
            >
              <div className="w-14 text-center text-5xl leading-none">
                {TURN_ICON[progress.next?.type ?? "straight"]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-2xl font-bold">{formatDistance(progress.distToNext)}</div>
                <div className="truncate text-base">{progress.next?.text ?? "직진"}</div>
                <div className="text-xs text-emerald-100">
                  남은 거리 {formatDistance(progress.remaining)} · 약{" "}
                  {formatEta(progress.remaining / cruiseMs)} · 🔊 다시 듣기
                </div>
              </div>
            </button>
            <button
              onClick={stopNavigation}
              className="rounded-xl bg-black/30 px-3 py-2 text-sm"
              aria-label="길 안내 종료"
            >
              종료
            </button>
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

        <div className="absolute bottom-3 right-3 z-[1000] flex flex-col gap-2">
          <MapButton
            active={settings.cycleLayer}
            onClick={() => update("cycleLayer", !settings.cycleLayer)}
            label="자전거도로 지도"
          >
            🚲
          </MapButton>
          <MapButton active={!!parkingData.parking} onClick={() => setSheet("parking")} label="주차 위치">
            🅿️
          </MapButton>
          <MapButton active={false} onClick={() => setSheet("location")} label="내 위치 정보">
            ℹ︎
          </MapButton>
          <MapButton active={follow} onClick={() => locateMe()} label="현재 위치 찾기">
            <svg
              viewBox="0 0 24 24"
              className={`mx-auto h-6 w-6 ${locating ? "animate-pulse" : ""}`}
              fill="currentColor"
              aria-hidden
            >
              <path d="M21 3 3 10.5l7.2 2.3L12.5 20z" />
            </svg>
          </MapButton>
        </div>
      </main>

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
              <button onClick={navigateToParking} className="shrink-0 rounded-full bg-blue-700 px-4 py-2 text-sm">
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
                      {position && ` · 직선 ${formatDistance(haversine(position, r.location))}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 text-sm text-slate-400">경로 옵션</div>
          <div className="mt-1 grid grid-cols-3 gap-2">
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
                    <Stat label="예상 시간" value={formatEta(route.distance / cruiseMs)} />
                    <Stat
                      label="자전거도로"
                      value={route.cyclewayRatio === null ? "-" : `${Math.round(route.cyclewayRatio * 100)}%`}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {route.source === "brouter" ? "BRouter" : "OSRM 자전거"} 경로 · 예상 시간은 평균{" "}
                    {settings.cruiseSpeed}km/h 기준
                  </div>
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
              label={`평균 주행 속도 ${settings.cruiseSpeed}km/h (도착 시간 계산)`}
              min={10}
              max={35}
              step={1}
              value={settings.cruiseSpeed}
              onChange={(v) => update("cruiseSpeed", v)}
            />
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
          </Section>

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
