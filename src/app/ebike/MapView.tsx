"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/ebike/geo";
import type { Route } from "@/lib/ebike/routing";

type Props = {
  position: LatLng | null;
  heading: number | null;
  accuracy: number | null;
  route: Route | null;
  destination: LatLng | null;
  /** 경유지 */
  via: LatLng[];
  /** 기록 보기: 지난 주행 경로 */
  track: LatLng[] | null;
  /** 저장한 주차 위치 */
  parking: LatLng | null;
  /** 값이 바뀔 때마다 지도를 이 위치로 이동 */
  focus: { p: LatLng; key: number } | null;
  follow: boolean;
  /** 야간 지도 (타일 색 반전) */
  dark: boolean;
  /** 진행 방향이 위로 오도록 지도 회전 */
  headingUp: boolean;
  /** 속도계 크게 보기 등으로 지도가 숨겨져 있음 */
  hidden: boolean;
  cycleLayer: boolean;
  pickMode: boolean;
  onPick: (p: LatLng) => void;
  onUserPan: () => void;
};

type RotatableMap = Leaflet.Map & { setBearing?: (deg: number) => void };

const DEFAULT_CENTER: LatLng = { lat: 37.5665, lng: 126.978 }; // 서울시청

function positionIcon(L: typeof Leaflet, heading: number | null) {
  const arrow =
    heading === null
      ? ""
      : `<div style="position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(-50%,-50%) rotate(${heading}deg) translateY(-17px);border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:12px solid #2563eb;"></div>`;
  return L.divIcon({
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div style="position:relative;width:44px;height:44px">${arrow}<div style="position:absolute;left:50%;top:50%;width:20px;height:20px;transform:translate(-50%,-50%);border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.45)"></div></div>`,
  });
}

export default function MapView(props: Props) {
  const {
    position,
    heading,
    accuracy,
    route,
    destination,
    track,
    parking,
    focus,
    follow,
    cycleLayer,
    dark,
    headingUp,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const cycleLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const posMarkerRef = useRef<Leaflet.Marker | null>(null);
  const accCircleRef = useRef<Leaflet.Circle | null>(null);
  const routeLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const destMarkerRef = useRef<Leaflet.CircleMarker | null>(null);
  const viaLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const trackLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const parkingMarkerRef = useRef<Leaflet.Marker | null>(null);
  const callbacksRef = useRef(props);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = props;
  });

  // 진행 방향 위 모드에서는 지도가 돌아가므로 화살표는 항상 위쪽
  const arrowHeading = heading === null ? null : headingUp ? 0 : heading;

  // 지도 초기화
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      // 회전 플러그인은 전역 L을 확장하므로 먼저 등록
      (window as unknown as { L: typeof Leaflet }).L = L;
      await import("leaflet-rotate/dist/leaflet-rotate.js");
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current, {
        center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
        zoom: 13,
        zoomControl: false,
        attributionControl: true,
        rotate: true,
        touchRotate: false,
        rotateControl: false,
        bearing: 0,
      } as Leaflet.MapOptions);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      cycleLayerRef.current = L.tileLayer(
        "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
        { maxZoom: 19, subdomains: "abc", attribution: "CyclOSM", opacity: 0.85 },
      );
      routeLayerRef.current = L.layerGroup().addTo(map);
      trackLayerRef.current = L.layerGroup().addTo(map);
      map.on("dragstart", () => callbacksRef.current.onUserPan());
      map.on("click", (e: Leaflet.LeafletMouseEvent) => {
        if (callbacksRef.current.pickMode) {
          callbacksRef.current.onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
      });
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // 자전거도로 레이어 (CyclOSM)
  useEffect(() => {
    const map = mapRef.current;
    const layer = cycleLayerRef.current;
    if (!ready || !map || !layer) return;
    if (cycleLayer) layer.addTo(map);
    else layer.remove();
  }, [ready, cycleLayer]);

  // 현재 위치 표시
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || !position) return;
    const ll: Leaflet.LatLngExpression = [position.lat, position.lng];
    if (!posMarkerRef.current) {
      posMarkerRef.current = L.marker(ll, {
        icon: positionIcon(L, arrowHeading),
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(map);
      accCircleRef.current = L.circle(ll, {
        radius: accuracy ?? 0,
        color: "#2563eb",
        weight: 1,
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(map);
      map.setView(ll, 16);
    } else {
      posMarkerRef.current.setLatLng(ll);
      posMarkerRef.current.setIcon(positionIcon(L, arrowHeading));
      accCircleRef.current?.setLatLng(ll).setRadius(accuracy ?? 0);
    }
  }, [ready, position, arrowHeading, accuracy]);

  // 숨겨졌다가 다시 보일 때 지도 크기 재계산
  useEffect(() => {
    if (!ready || props.hidden) return;
    mapRef.current?.invalidateSize();
  }, [ready, props.hidden]);

  // 진행 방향이 위로: 지도를 -heading 만큼 회전 (위치 화살표는 위를 향함)
  useEffect(() => {
    const map = mapRef.current as RotatableMap | null;
    if (!ready || !map?.setBearing) return;
    map.setBearing(headingUp && heading !== null ? (360 - heading) % 360 : 0);
  }, [ready, headingUp, heading]);

  // 따라가기
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !position || !follow) return;
    map.setView([position.lat, position.lng], Math.max(map.getZoom(), 16), { animate: true });
  }, [ready, position, follow]);

  // 경로 표시
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = routeLayerRef.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    if (!route) return;
    const latlngs = route.coords.map((c) => [c.lat, c.lng] as [number, number]);
    L.polyline(latlngs, { color: "#ffffff", weight: 10, opacity: 0.9 }).addTo(group);
    const line = L.polyline(latlngs, { color: "#16a34a", weight: 6 }).addTo(group);
    for (const m of route.maneuvers) {
      if (m.type === "arrive") continue;
      L.circleMarker([m.location.lat, m.location.lng], {
        radius: 4,
        color: "#14532d",
        fillColor: "#fff",
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(m.text)
        .addTo(group);
    }
    if (!callbacksRef.current.follow) {
      map.fitBounds(line.getBounds(), { padding: [40, 40] });
    }
  }, [ready, route]);

  // 경유지 표시 (번호가 붙은 주황색 점)
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    viaLayerRef.current?.remove();
    viaLayerRef.current = null;
    if (props.via.length === 0) return;
    const group = L.layerGroup().addTo(map);
    props.via.forEach((v, i) =>
      L.marker([v.lat, v.lng], {
        icon: L.divIcon({
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          html: `<div style="width:26px;height:26px;border-radius:9999px;background:#f59e0b;border:3px solid #fff;color:#111;font:700 13px/20px sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.4)">${i + 1}</div>`,
        }),
      })
        .bindTooltip(`경유지 ${i + 1}`)
        .addTo(group),
    );
    viaLayerRef.current = group;
  }, [ready, props.via]);

  // 목적지 표시
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    destMarkerRef.current?.remove();
    destMarkerRef.current = null;
    if (!destination) return;
    destMarkerRef.current = L.circleMarker([destination.lat, destination.lng], {
      radius: 10,
      color: "#fff",
      weight: 3,
      fillColor: "#dc2626",
      fillOpacity: 1,
    }).addTo(map);
  }, [ready, destination]);

  // 주차 위치 표시
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    parkingMarkerRef.current?.remove();
    parkingMarkerRef.current = null;
    if (!parking) return;
    parkingMarkerRef.current = L.marker([parking.lat, parking.lng], {
      icon: L.divIcon({
        className: "",
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        html: '<div style="width:34px;height:34px;border-radius:8px;background:#2563eb;border:3px solid #fff;color:#fff;font:700 18px/28px sans-serif;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,.4)">P</div>',
      }),
      zIndexOffset: 500,
    })
      .bindTooltip("주차 위치")
      .addTo(map);
  }, [ready, parking]);

  // 특정 위치로 지도 이동 (주차 위치 보기 등)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    map.setView([focus.p.lat, focus.p.lng], 17, { animate: true });
  }, [ready, focus]);

  // 지난 주행 경로 표시
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = trackLayerRef.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    if (!track || track.length === 0) return;
    const latlngs = track.map((c) => [c.lat, c.lng] as [number, number]);
    L.polyline(latlngs, { color: "#ffffff", weight: 9, opacity: 0.9 }).addTo(group);
    const line = L.polyline(latlngs, { color: "#7c3aed", weight: 5 }).addTo(group);
    const dot = (p: [number, number], fill: string, label: string) =>
      L.circleMarker(p, { radius: 8, color: "#fff", weight: 3, fillColor: fill, fillOpacity: 1 })
        .bindTooltip(label)
        .addTo(group);
    dot(latlngs[0], "#16a34a", "출발");
    dot(latlngs[latlngs.length - 1], "#dc2626", "도착");
    map.fitBounds(line.getBounds(), { padding: [40, 40] });
  }, [ready, track]);

  return (
    // React가 바꾸는 class는 바깥 div에만 둔다 (Leaflet이 지도 div에 붙인 class를 덮어쓰지 않도록)
    <div
      className={`absolute inset-0 ${props.pickMode ? "cursor-crosshair" : ""} ${dark ? "ebike-map-dark" : ""}`}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ background: dark ? "#1a1f29" : "#e5e7eb" }}
      />
    </div>
  );
}
