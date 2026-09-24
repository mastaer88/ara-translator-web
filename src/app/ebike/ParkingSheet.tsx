"use client";

import { useState } from "react";
import { formatDistance, haversine, type LatLng } from "@/lib/ebike/geo";
import type { Parking } from "@/lib/ebike/places";
import { Sheet, Stat } from "./ui";

type Props = {
  parking: Parking | null;
  position: LatLng | null;
  saving: boolean;
  onSave: (memo: string) => void;
  onClear: () => void;
  onNavigate: () => void;
  onShow: () => void;
  onClose: () => void;
};

function ago(ts: number) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 ${min % 60}분 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function ParkingSheet(props: Props) {
  const { parking, position } = props;
  const [memo, setMemo] = useState("");

  return (
    <Sheet title="🅿️ 주차 위치" onClose={props.onClose}>
      {parking ? (
        <>
          <div className="rounded-xl bg-slate-800/60 p-3">
            <div className="text-xs text-slate-400">저장한 시간</div>
            <div className="font-semibold">
              {new Date(parking.savedAt).toLocaleString("ko-KR", {
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              <span className="text-sm font-normal text-slate-400">({ago(parking.savedAt)})</span>
            </div>
            {parking.memo && (
              <>
                <div className="mt-2 text-xs text-slate-400">메모</div>
                <div className="whitespace-pre-wrap">{parking.memo}</div>
              </>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center">
            <Stat
              label="여기서 거리"
              value={position ? formatDistance(haversine(position, parking)) : "-"}
            />
            <Stat
              label="정확도"
              value={parking.accuracy !== null ? `±${Math.round(parking.accuracy)}m` : "-"}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <button className="rounded-lg bg-blue-600 py-2.5 font-semibold" onClick={props.onNavigate}>
              🧭 주차 위치로 길찾기
            </button>
            <button className="rounded-lg bg-slate-700 py-2.5" onClick={props.onShow}>
              🗺 지도에서 보기
            </button>
            <button
              className="col-span-2 rounded-lg bg-emerald-600 py-2.5 font-semibold"
              onClick={() => {
                if (confirm("자전거를 찾으셨나요? 저장된 주차 위치를 지웁니다.")) props.onClear();
              }}
            >
              ✅ 찾았어요 (주차 위치 지우기)
            </button>
          </div>
          <p className="mt-4 text-xs text-slate-500">새 위치에 세웠다면 아래에서 다시 저장하세요.</p>
        </>
      ) : (
        <p className="rounded-xl bg-slate-800/50 p-3 text-sm text-slate-300">
          자전거를 세운 곳을 저장해 두면 나중에 지도와 길찾기로 쉽게 찾을 수 있습니다.
        </p>
      )}

      <div className="mt-3 rounded-xl bg-slate-800/50 p-3">
        <label className="text-xs text-slate-400" htmlFor="parking-memo">
          메모 (선택) — 예: 지하 2층 C-3 기둥 옆
        </label>
        <textarea
          id="parking-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          maxLength={200}
          className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-base outline-none ring-blue-500 focus:ring-2"
        />
        <button
          disabled={props.saving}
          onClick={() => props.onSave(memo.trim())}
          className="mt-2 w-full rounded-xl bg-amber-500 py-3 font-bold text-black disabled:opacity-60"
        >
          {props.saving ? "현재 위치 확인 중…" : "📍 지금 위치를 주차 위치로 저장"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        실내·지하 주차장은 GPS가 부정확할 수 있으니 메모를 함께 남겨 두세요.
      </p>
    </Sheet>
  );
}
