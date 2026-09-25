"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { renderRideImage, shareImage } from "@/lib/ebike/shareImage";
import { formatDistance, formatDuration } from "@/lib/ebike/geo";
import { computeTotals, type RideRecord } from "@/lib/ebike/rideStore";
import RideCharts from "./RideCharts";
import StatsView from "./StatsView";
import { Sheet, Stat } from "./ui";

type Props = {
  rides: RideRecord[];
  currentDistance: number;
  onClose: () => void;
  onView: (ride: RideRecord) => void;
  onExport: (ride: RideRecord) => void;
  onNavigate: (ride: RideRecord) => void;
  onDelete: (ride: RideRecord) => void;
  /** 통계의 배터리 사용량 추정용 (Wh/km) */
  whPerKm: number;
};

const avgOf = (r: RideRecord) => (r.movingTime > 0 ? (r.distance / r.movingTime) * 3.6 : 0);

function dateLabel(ts: number) {
  const d = new Date(ts);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export default function HistorySheet(props: Props) {
  const { rides, currentDistance } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"rides" | "stats">("rides");
  const [preview, setPreview] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const [making, setMaking] = useState(false);

  // 미리보기 이미지 주소 정리
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const makeImage = async (r: RideRecord) => {
    setMaking(true);
    try {
      const blob = await renderRideImage(r);
      const d = new Date(r.startedAt);
      const name = `ebike-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.png`;
      setPreview({ url: URL.createObjectURL(blob), blob, name });
    } catch {
      toast.error("이미지를 만들지 못했습니다.");
    } finally {
      setMaking(false);
    }
  };
  const totals = computeTotals(rides);

  return (
    <Sheet title="주행 기록" onClose={props.onClose}>
      <div className="rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-900 p-4">
        <div className="text-xs text-emerald-100">누적 주행 거리</div>
        <div className="font-mono text-4xl font-bold tabular-nums">
          {((totals.distance + currentDistance) / 1000).toFixed(1)}
          <span className="ml-1 text-lg font-normal">km</span>
        </div>
        <div className="mt-1 text-xs text-emerald-100">
          총 {totals.count}회 · 주행 시간 {formatDuration(totals.movingTime)}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="이번 주" value={formatDistance(totals.weekDistance)} />
        <Stat label="이번 달" value={formatDistance(totals.monthDistance)} />
        <Stat label="최장 거리" value={formatDistance(totals.longest)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-800/60 p-1 text-sm" role="tablist">
        {(
          [
            ["rides", "📋 지난 주행"],
            ["stats", "📊 월별 통계"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-lg py-2 ${tab === id ? "bg-slate-600 font-semibold" : "text-slate-400"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "stats" && (
        <div className="mt-3">
          <StatsView rides={rides} whPerKm={props.whPerKm} />
        </div>
      )}

      {tab === "rides" && (
        <>
          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-400">지난 주행</h3>
          {rides.length === 0 && (
            <p className="rounded-xl bg-slate-800/50 p-4 text-center text-sm text-slate-400">
              아직 저장된 주행이 없습니다.
              <br />
              주행 시작 → 종료하면 코스가 자동으로 저장됩니다.
            </p>
          )}
          <ul className="space-y-2">
            {rides.map((r) => {
              const open = openId === r.id;
              return (
                <li key={r.id} className="overflow-hidden rounded-xl bg-slate-800/60">
                  <button className="w-full p-3 text-left" onClick={() => setOpenId(open ? null : r.id)}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-slate-300">{dateLabel(r.startedAt)}</span>
                      <span className="font-mono text-lg font-bold">{formatDistance(r.distance)}</span>
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {r.startName && r.endName ? `${r.startName} → ${r.endName}` : "코스 정보"} ·{" "}
                      {formatDuration(r.elapsed)} · 평균 {avgOf(r).toFixed(1)}km/h
                    </div>
                  </button>
                  {open && (
                    <div className="border-t border-slate-700 p-3">
                      <div className="grid grid-cols-4 gap-1 text-center">
                        <Stat label="거리" value={formatDistance(r.distance)} />
                        <Stat label="시간" value={formatDuration(r.elapsed)} />
                        <Stat label="평균" value={avgOf(r).toFixed(1)} />
                        <Stat label="최고" value={r.maxSpeed.toFixed(1)} />
                      </div>
                      <dl className="mt-2 space-y-0.5 text-xs text-slate-400">
                        <div>
                          출발: {r.startName ?? "-"} ({new Date(r.startedAt).toLocaleTimeString("ko-KR")})
                        </div>
                        <div>
                          도착: {r.endName ?? "-"} ({new Date(r.endedAt).toLocaleTimeString("ko-KR")})
                        </div>
                        <div>주행(이동) 시간: {formatDuration(r.movingTime)}</div>
                      </dl>
                      <RideCharts ride={r} />
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <button
                          className="rounded-lg bg-violet-600 py-2 font-semibold"
                          onClick={() => props.onView(r)}
                        >
                          🗺 지도에서 보기
                        </button>
                        <button className="rounded-lg bg-blue-600 py-2" onClick={() => props.onNavigate(r)}>
                          🧭 도착지로 길찾기
                        </button>
                        <button className="rounded-lg bg-slate-700 py-2" onClick={() => props.onExport(r)}>
                          ⤴︎ GPX 내보내기
                        </button>
                        <button
                          className="col-span-2 rounded-lg bg-emerald-700 py-2 font-semibold disabled:opacity-60"
                          disabled={making}
                          onClick={() => makeImage(r)}
                        >
                          {making ? "이미지 만드는 중…" : "🖼 요약 이미지 만들기"}
                        </button>
                        <button
                          className="rounded-lg bg-slate-700 py-2 text-red-300"
                          onClick={() => {
                            if (confirm("이 주행 기록을 삭제할까요?")) props.onDelete(r);
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        기록은 이 아이폰의 Safari 안에만 저장됩니다. Safari 방문 기록·웹사이트 데이터를 지우면 함께 지워지니,
        중요한 코스는 GPX로 내보내 두세요 (Strava·Garmin 등에서 가져오기 가능).
      </p>
      {preview && (
        <div
          className="fixed inset-0 z-[2600] flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
          role="dialog"
          aria-label="주행 요약 이미지"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="주행 요약 이미지" className="max-h-[70vh] w-auto rounded-xl" />
          <p className="text-xs text-slate-400">이미지를 길게 누르면 사진에 저장할 수 있습니다</p>
          <div className="flex w-full max-w-sm gap-2">
            <button onClick={() => setPreview(null)} className="flex-1 rounded-xl bg-slate-700 py-3">
              닫기
            </button>
            <button
              onClick={() => shareImage(preview.name, preview.blob)}
              className="flex-[2] rounded-xl bg-emerald-500 py-3 font-bold text-black"
            >
              ⤴︎ 공유
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
