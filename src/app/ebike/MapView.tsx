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
  follow: boolean;
  cycleLayer: boolean;
  pickMode: boolean;
  onPick: (p: LatLng) => void;
  onUserPan: () => void;
};

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
  const { position, heading, accuracy, route, destination, follow, cycleLayer } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const cycleLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const posMarkerRef = useRef<Leaflet.Marker | null>(null);
  const accCircleRef = useRef<Leaflet.Circle | null>(null);
  const routeLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const destMarkerRef = useRef<Leaflet.CircleMarker | null>(null);
  const callbacksRef = useRef(props);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = props;
  });

  // 지도 초기화
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = mod.default;
      LRef.current = L;
      const map = L.map(containerRef.current, {
        center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
        zoom: 13,
        zoomControl: false,
        attributionControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      cycleLayerRef.current = L.tileLayer(
        "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
        { maxZoom: 19, subdomains: "abc", attribution: "CyclOSM", opacity: 0.85 },
      );
      routeLayerRef.current = L.layerGroup().addTo(map);
      map.on("dragstart", () => callbacksRef.current.onUserPan());
      map.on("click", (e: Leaflet.LeafletMouseEvent) => {
        if (callbacksRef.current.pickMode) {
          callbacksRef.current.onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
      });
      mapRef.current = map;
      setReady(true);
    });
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
        icon: positionIcon(L, heading),
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
      posMarkerRef.current.setIcon(positionIcon(L, heading));
      accCircleRef.current?.setLatLng(ll).setRadius(accuracy ?? 0);
    }
  }, [ready, position, heading, accuracy]);

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

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 ${props.pickMode ? "cursor-crosshair" : ""}`}
      style={{ background: "#e5e7eb" }}
    />
  );
}
