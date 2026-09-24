"use client";

import { formatDistance, formatEta } from "@/lib/ebike/geo";
import type { CoachAdvice, RouteEnergy } from "@/lib/ebike/energy";
import type { Route } from "@/lib/ebike/routing";

type Candidate = { route: Route; energy: RouteEnergy };

type Props = {
  /** 배터리 절약 모드에서 비교한 경로들 (배터리 적게 드는 순) */
  candidates: Candidate[] | null;
  selected: Route;
  onSelect: (r: Route) => void;
  energy: RouteEnergy;
  advice: CoachAdvice | null;
  capacityWh: number;
  onOpenBattery: () => void;
};

/** 기준 단계(가운데) 사용량 */
const normalWh = (e: RouteEnergy) => e.levels[Math.floor((e.levels.length - 1) / 2)].wh;

export default function CoachPanel({
  candidates,
  selected,
  onSelect,
  energy,
  advice,
  capacityWh,
  onOpenBattery,
}: Props) {
  const pctOf = (wh: number) => Math.round((wh / capacityWh) * 100);
  const minWh = candidates?.length ? Math.min(...candidates.map((c) => normalWh(c.energy))) : null;

  return (
    <div className="mt-3 space-y-3">
      {candidates && candidates.length > 1 && (
        <div>
          <div className="mb-1 text-xs text-slate-400">경로 비교 (기준 단계 배터리 사용)</div>
          <ul className="divide-y divide-slate-700/60 overflow-hidden rounded-xl bg-slate-900/60 text-sm">
            {candidates.map((c, i) => {
              const active = c.route === selected;
              const best = normalWh(c.energy) === minWh;
              return (
                <li key={i}>
                  <button
                    onClick={() => onSelect(c.route)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left ${active ? "bg-emerald-900/50" : ""}`}
                  >
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full border-2 ${active ? "border-emerald-400 bg-emerald-400" : "border-slate-500"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{c.route.label ?? "경로"}</span>
                      {best && <span className="ml-1 rounded bg-emerald-700 px-1 text-[10px]">🔋 최소</span>}
                      <span className="block text-xs text-slate-400">
                        {formatDistance(c.route.distance)} · 오르막 {Math.round(c.energy.climb)}m
                        {c.route.cyclewayRatio !== null &&
                          ` · 자전거도로 ${Math.round(c.route.cyclewayRatio * 100)}%`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <b>{pctOf(normalWh(c.energy))}%</b>
                      <span className="block text-xs text-slate-400">{Math.round(normalWh(c.energy))}Wh</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-baseline justify-between text-xs text-slate-400">
          <span>보조 단계 코치</span>
          <span>
            오르막 {Math.round(energy.climb)}m · 내리막 {Math.round(energy.descent)}m
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="py-1 text-left font-normal">단계</th>
              <th className="py-1 text-right font-normal">배터리 사용</th>
              <th className="py-1 text-right font-normal">{advice ? "도착 시 잔량" : ""}</th>
              <th className="py-1 text-right font-normal">시간</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {energy.levels.map((l) => {
              const rec = advice?.recommended?.id === l.level.id;
              const arrive = advice ? advice.arrivePercent[l.level.id] : null;
              return (
                <tr
                  key={l.level.id}
                  className={`border-t border-slate-700/60 ${rec ? "bg-emerald-900/40" : ""}`}
                >
                  <td className="py-1.5">
                    {l.level.name}
                    {rec && (
                      <span className="ml-1 rounded bg-emerald-600 px-1 text-[10px] text-black">
                        여기까지 OK
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">{pctOf(l.wh)}%</td>
                  <td className={`py-1.5 text-right ${arrive !== null && arrive < 15 ? "text-red-300" : ""}`}>
                    {arrive === null ? "" : `${Math.max(0, Math.round(arrive))}%`}
                  </td>
                  <td className="py-1.5 text-right text-slate-300">{formatEta(l.timeSec)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {advice ? (
          advice.recommended ? (
            <p className="mt-1 text-xs text-emerald-300">
              👉 <b>{advice.recommended.name}</b> 단계까지 써도 도착 시 배터리 약{" "}
              {Math.round(advice.arrivePercent[advice.recommended.id])}%가 남습니다 (여유 15% 이상 기준).
            </p>
          ) : (
            <p className="mt-1 text-xs text-red-300">
              ⚠️ 가장 낮은 단계({energy.levels[0].level.name})로도 약 {advice.shortKm?.toFixed(1)}km
              부족합니다. 충전하거나 가까운 곳을 경유하세요.
            </p>
          )
        ) : (
          <button onClick={onOpenBattery} className="mt-1 text-xs text-yellow-300 underline">
            🔋 지금 배터리 %를 입력하면 도착 시 잔량과 추천 단계를 알려드려요
          </button>
        )}
        <p className="mt-1 text-[11px] text-slate-500">
          오르막·거리·바람과 내 무게, 학습된 소모량으로 계산한 추정값입니다.
        </p>
      </div>
    </div>
  );
}
