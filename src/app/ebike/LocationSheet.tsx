"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { LatLng } from "@/lib/ebike/geo";
import { addressOf } from "@/lib/ebike/routing";
import { Sheet, Stat } from "./ui";

type Props = {
  /** GPS가 켜져 있으면 현재 위치, 아니면 null (이 화면에서 한 번 조회) */
  position: LatLng | null;
  accuracy: number | null;
  onClose: () => void;
};

type Fix = { p: LatLng; accuracy: number | null; altitude: number | null };

export default function LocationSheet({ position, accuracy, onClose }: Props) {
  const [fix, setFix] = useState<Fix | null>(position ? { p: position, accuracy, altitude: null } : null);
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // GPS가 꺼져 있으면 현재 위치를 한 번만 조회 (고도 포함)
  useEffect(() => {
    if (position) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setFix({
          p: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
        }),
      (err) => {
        setError(err.code === err.PERMISSION_DENIED ? "위치 권한이 거부되었습니다." : "위치를 찾을 수 없습니다.");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, [position]);

  const lat = fix?.p.lat;
  const lng = fix?.p.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let cancelled = false;
    addressOf({ lat, lng }).then((a) => {
      if (cancelled) return;
      setAddress(a);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  const coordText = fix ? `${fix.p.lat.toFixed(6)}, ${fix.p.lng.toFixed(6)}` : "";
  const appleUrl = fix ? `https://maps.apple.com/?ll=${fix.p.lat},${fix.p.lng}&q=${encodeURIComponent("내 위치")}` : "";
  const kakaoUrl = fix ? `https://map.kakao.com/link/map/${encodeURIComponent("내 위치")},${fix.p.lat},${fix.p.lng}` : "";

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("복사했습니다");
    } catch {
      toast.error("복사하지 못했습니다");
    }
  };

  const share = async () => {
    const text = `📍 내 위치${address ? `: ${address}` : ""}\n${coordText}\n${appleUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "내 위치", text });
      } catch {
        // 사용자가 취소
      }
    } else {
      copy(text);
    }
  };

  return (
    <Sheet title="내 위치 정보" onClose={onClose}>
      {error && <p className="rounded-xl bg-red-900/40 p-3 text-sm text-red-200">{error}</p>}
      {!error && !fix && <p className="text-sm text-slate-400">현재 위치 확인 중…</p>}
      {fix && (
        <>
          <div className="rounded-xl bg-slate-800/60 p-3">
            <div className="text-xs text-slate-400">주소</div>
            <div className="mt-0.5 text-base font-semibold leading-snug">
              {address ?? (loading ? "주소 찾는 중…" : "주소를 찾지 못했습니다")}
            </div>
            <div className="mt-2 text-xs text-slate-400">좌표 (위도, 경도)</div>
            <div className="font-mono text-sm">{coordText}</div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center">
            <Stat label="정확도" value={fix.accuracy !== null ? `±${Math.round(fix.accuracy)}m` : "-"} />
            <Stat label="고도" value={fix.altitude !== null ? `${Math.round(fix.altitude)}m` : "-"} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <button className="rounded-lg bg-blue-600 py-2.5 font-semibold" onClick={share}>
              ⤴︎ 위치 공유
            </button>
            <button className="rounded-lg bg-slate-700 py-2.5" onClick={() => copy(address ? `${address} (${coordText})` : coordText)}>
              주소·좌표 복사
            </button>
            <a className="rounded-lg bg-slate-700 py-2.5 text-center" href={kakaoUrl} target="_blank" rel="noreferrer">
              카카오맵에서 보기
            </a>
            <a className="rounded-lg bg-slate-700 py-2.5 text-center" href={appleUrl} target="_blank" rel="noreferrer">
              Apple 지도에서 보기
            </a>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            위치 공유는 문자·카카오톡 등으로 가족에게 현재 위치를 보낼 때 쓰세요.
          </p>
        </>
      )}
    </Sheet>
  );
}
