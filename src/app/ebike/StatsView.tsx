"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/ebike/geo";
import type { RideRecord } from "@/lib/ebike/rideStore";
import { Stat } from "./ui";

/** 어두운 화면용 막대 색 (주행 그래프와 같은 색, 어두운 배경 대비 검증됨) */
const BAR = "#3987e5";
const GRID = "rgba(148, 163, 184, 0.18)";
const AXIS_TEXT = "#94a3b8";

type Month = {
  key: string;
  label: string;
  year: number;
  month: number;
  rides: number;
  distance: number;
  movingTime: number;
  maxSpeed: number;
};

/** 최근 12개월 (주행이 없는 달도 포함) */
function monthlyBuckets(rides: RideRecord[], now = new Date()): Month[] {
  const months: Month[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: `${d.getMonth() + 1}월`,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      rides: 0,
      distance: 0,
      movingTime: 0,
      maxSpeed: 0,
    });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const r of rides) {
    const d = new Date(r.startedAt);
    const m = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (!m) continue;
    m.rides++;
    m.distance += r.distance;
    m.movingTime += r.movingTime;
    m.maxSpeed = Math.max(m.maxSpeed, r.maxSpeed);
  }
  return months;
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function MonthlyChart({ months }: { months: Month[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 170;
  const pad = { l: 34, r: 6, t: 10, b: 22 };
  const w = width - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const kms = months.map((m) => m.distance / 1000);
  const step = niceStep(Math.max(...kms, 1));
  const yMax = Math.max(step, Math.ceil(Math.max(...kms) / step) * step);
  const slot = w / months.length;
  const barW = Math.max(6, slot - 4); // 막대 사이 간격
  const y = (v: number) => pad.t + h - (v / yMax) * h;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);

  const hm = hover !== null ? months[hover] : null;

  return (
    <div ref={wrapRef} className="relative">
      <svg
        width={width}
        height={H}
        className="block select-none"
        style={{ touchAction: "pan-y" }}
        role="img"
        aria-label="최근 12개월 월별 주행 거리 막대 그래프"
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={pad.l + w} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
              {v}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          const km = m.distance / 1000;
          const top = y(km);
          const bh = pad.t + h - top;
          const r = Math.min(4, barW / 2, bh);
          return (
            <g key={m.key}>
              {km > 0 && (
                // 위쪽 모서리만 둥근 막대 (바닥에 붙음)
                <path
                  d={`M${x},${pad.t + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${
                    x + barW
                  },${top + r}V${pad.t + h}Z`}
                  fill={BAR}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {/* 막대보다 넓은 터치 영역 */}
              <rect
                x={pad.l + i * slot}
                y={pad.t}
                width={slot}
                height={h}
                fill="transparent"
                onPointerDown={() => setHover(i)}
                onPointerEnter={() => setHover(i)}
              />
              {(i % 2 === 1 || width > 420) && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hm && (
        <div
          className="pointer-events-none absolute top-0 rounded-md bg-slate-950/90 px-2 py-1 text-xs text-slate-100 shadow"
          style={{ left: Math.min(Math.max(pad.l + hover! * slot - 40, 0), width - 130) }}
        >
          <span className="text-slate-400">
            {hm.year}년 {hm.month}월
          </span>{" "}
          <b className="tabular-nums">{(hm.distance / 1000).toFixed(1)}km</b>
          <span className="text-slate-400"> · {hm.rides}회</span>
        </div>
      )}
    </div>
  );
}

export default function StatsView({ rides, whPerKm }: { rides: RideRecord[]; whPerKm: number }) {
  const months = useMemo(() => monthlyBuckets(rides), [rides]);
  const year = new Date().getFullYear();
  const yearRides = rides.filter((r) => new Date(r.startedAt).getFullYear() === year);
  const yearKm = yearRides.reduce((t, r) => t + r.distance, 0) / 1000;
  const yearTime = yearRides.reduce((t, r) => t + r.movingTime, 0);
  const avg = yearTime > 0 ? (yearKm / yearTime) * 3600 : 0;
  const active = months.filter((m) => m.rides > 0);
  const best = active.length ? active.reduce((b, m) => (m.distance > b.distance ? m : b)) : null;

  if (rides.length === 0) {
    return (
      <p className="rounded-xl bg-slate-800/50 p-4 text-center text-sm text-slate-400">
        아직 통계를 낼 주행 기록이 없습니다.
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat label={`${year}년 거리`} value={`${yearKm.toFixed(0)}km`} />
        <Stat label={`${year}년 주행`} value={`${yearRides.length}회`} />
        <Stat label="평균 속도" value={`${avg.toFixed(1)}km/h`} />
        <Stat label="배터리 사용 (추정)" value={`${((yearKm * whPerKm) / 1000).toFixed(1)}kWh`} />
      </div>

      <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-300">월별 주행 거리 (km)</h3>
      <MonthlyChart months={months} />
      {best && (
        <p className="mt-1 text-xs text-slate-400">
          가장 많이 달린 달: {best.year}년 {best.month}월 · {(best.distance / 1000).toFixed(1)}km
        </p>
      )}

      <table className="mt-3 w-full text-xs tabular-nums">
        <caption className="mb-1 text-left text-xs text-slate-400">
          월별 기록 (최근 12개월, 주행한 달만)
        </caption>
        <thead className="text-slate-400">
          <tr>
            <th className="py-1 text-left font-normal">달</th>
            <th className="py-1 text-right font-normal">횟수</th>
            <th className="py-1 text-right font-normal">거리</th>
            <th className="py-1 text-right font-normal">주행 시간</th>
            <th className="py-1 text-right font-normal">평균</th>
            <th className="py-1 text-right font-normal">최고</th>
          </tr>
        </thead>
        <tbody>
          {[...active].reverse().map((m) => (
            <tr key={m.key} className="border-t border-slate-700/60">
              <td className="py-1.5">
                {m.year}.{String(m.month).padStart(2, "0")}
              </td>
              <td className="py-1.5 text-right">{m.rides}</td>
              <td className="py-1.5 text-right text-slate-100">{(m.distance / 1000).toFixed(1)}km</td>
              <td className="py-1.5 text-right">{formatDuration(m.movingTime)}</td>
              <td className="py-1.5 text-right">
                {m.movingTime > 0 ? ((m.distance / m.movingTime) * 3.6).toFixed(1) : "-"}
              </td>
              <td className="py-1.5 text-right">{m.maxSpeed.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-500">
        PC 브라우저에서 같은 동기화 코드로 열면 모든 기기의 기록을 합쳐서 볼 수 있습니다.
      </p>
    </div>
  );
}
