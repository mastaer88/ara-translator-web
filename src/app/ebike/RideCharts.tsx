"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration, haversine } from "@/lib/ebike/geo";
import type { RideRecord } from "@/lib/ebike/rideStore";

/** 어두운 화면용 색 (검증: dark surface #1c2537 대비 3:1 이상, 두 색 구분 가능) */
const SPEED_COLOR = "#3987e5";
const ELEV_COLOR = "#199e70";
const GRID = "rgba(148, 163, 184, 0.18)";
const AXIS_TEXT = "#94a3b8";

type Sample = { d: number; v: number };

/** 거리(m) 기준 시계열로 변환 */
function toSeries(ride: RideRecord) {
  const dist: number[] = [0];
  for (let i = 1; i < ride.points.length; i++) {
    const [a, b] = [ride.points[i - 1], ride.points[i]];
    dist.push(dist[i - 1] + haversine({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }));
  }
  // 경로 길이를 기록된 주행 거리에 맞춤 (GPS 흔들림 보정 차이)
  const scale = dist[dist.length - 1] > 0 ? ride.distance / dist[dist.length - 1] : 1;
  const d = dist.map((x) => x * scale);

  const smooth = (vals: number[], k: number) =>
    vals.map((_, i) => {
      const s = vals.slice(Math.max(0, i - k), i + k + 1);
      return s.reduce((t, x) => t + x, 0) / s.length;
    });

  const speed = smooth(
    ride.points.map((p) => p[3]),
    1,
  ).map((v, i) => ({ d: d[i], v }));

  const altIdx = ride.points.map((p, i) => (typeof p[4] === "number" ? i : -1)).filter((i) => i >= 0);
  let elevation: Sample[] = [];
  let ascent = 0;
  if (altIdx.length >= Math.max(5, ride.points.length * 0.5)) {
    const alts = smooth(
      altIdx.map((i) => ride.points[i][4] as number),
      2,
    );
    elevation = alts.map((v, j) => ({ d: d[altIdx[j]], v }));
    // 2m 이상 오를 때만 누적 (GPS 고도 잡음 무시)
    let base = alts[0];
    for (const a of alts) {
      if (a - base >= 2) {
        ascent += a - base;
        base = a;
      } else if (a < base) base = a;
    }
  }

  // 1km 구간 기록 (구간 경계 시각은 선형 보간)
  const splits: { km: number; len: number; sec: number }[] = [];
  let prevD = 0;
  let prevT = 0;
  for (let k = 1000; ; k += 1000) {
    const i = d.findIndex((x) => x >= k);
    if (i <= 0) break;
    const f = (k - d[i - 1]) / (d[i] - d[i - 1] || 1);
    const t = ride.points[i - 1][2] + f * (ride.points[i][2] - ride.points[i - 1][2]);
    splits.push({ km: k / 1000, len: k - prevD, sec: t - prevT });
    prevD = k;
    prevT = t;
  }
  const total = d[d.length - 1];
  const lastT = ride.points[ride.points.length - 1]?.[2] ?? 0;
  if (total - prevD >= 100) splits.push({ km: total / 1000, len: total - prevD, sec: lastT - prevT });

  return { speed, elevation, ascent, splits };
}

/** 데이터 점을 최대 n개로 줄임 */
function downsample(s: Sample[], n = 240): Sample[] {
  if (s.length <= n) return s;
  const step = s.length / n;
  return Array.from({ length: n }, (_, i) => s[Math.floor(i * step)]).concat(s[s.length - 1]);
}

function niceMax(v: number, step: number) {
  return Math.max(step, Math.ceil(v / step) * step);
}

function LineChart({
  title,
  data,
  color,
  unit,
  area,
  yStep,
  zeroBased,
}: {
  title: React.ReactNode;
  data: Sample[];
  color: string;
  unit: string;
  area?: boolean;
  yStep: number;
  zeroBased: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => downsample(data), [data]);
  const H = 132;
  const pad = { l: 34, r: 8, t: 8, b: 20 };
  const w = width - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const maxD = pts[pts.length - 1]?.d || 1;
  const vals = pts.map((p) => p.v);
  const yMin = zeroBased ? 0 : Math.floor(Math.min(...vals) / yStep) * yStep;
  const yMax = zeroBased ? niceMax(Math.max(...vals), yStep) : Math.max(yMin + yStep, niceMax(Math.max(...vals), yStep));
  const x = (d: number) => pad.l + (d / maxD) * w;
  const y = (v: number) => pad.t + h - ((v - yMin) / (yMax - yMin)) * h;

  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const fill = `${line}L${x(maxD).toFixed(1)},${pad.t + h}L${pad.l},${pad.t + h}Z`;

  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += (yMax - yMin) / 2) yTicks.push(v);
  const kmStep = maxD > 20000 ? 5 : maxD > 8000 ? 2 : 1;
  const xTicks: number[] = [];
  for (let k = 0; k * 1000 <= maxD; k += kmStep) xTicks.push(k);

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = ((e.clientX - rect.left - pad.l) / w) * maxD;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].d - d) < Math.abs(pts[best].d - d)) best = i;
    setHover(best);
  };

  const hp = hover !== null ? pts[hover] : null;

  return (
    <figure className="mt-3">
      <figcaption className="mb-1 text-xs text-slate-300">{title}</figcaption>
      <div ref={wrapRef} className="relative">
        <svg
          width={width}
          height={H}
          className="block select-none"
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={typeof title === "string" ? title : undefined}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + w} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
              <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                {Math.round(v)}
              </text>
            </g>
          ))}
          {xTicks.map((k) => (
            <text key={k} x={x(k * 1000)} y={H - 5} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
              {k}km
            </text>
          ))}
          {area && <path d={fill} fill={color} opacity={0.22} />}
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hp && (
            <g>
              <line x1={x(hp.d)} x2={x(hp.d)} y1={pad.t} y2={pad.t + h} stroke="#e2e8f0" strokeWidth={1} opacity={0.6} />
              <circle cx={x(hp.d)} cy={y(hp.v)} r={5} fill={color} stroke="#0f172a" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute top-0 rounded-md bg-slate-950/90 px-2 py-1 text-xs text-slate-100 shadow"
            style={{
              left: Math.min(Math.max(x(hp.d) - 50, 0), width - 100),
            }}
          >
            <span className="text-slate-400">{(hp.d / 1000).toFixed(2)}km</span>{" "}
            <b className="tabular-nums">
              {hp.v.toFixed(1)}
              {unit}
            </b>
          </div>
        )}
      </div>
    </figure>
  );
}

export default function RideCharts({ ride }: { ride: RideRecord }) {
  const { speed, elevation, ascent, splits } = useMemo(() => toSeries(ride), [ride]);
  if (ride.points.length < 3) return null;

  const fastest = splits.reduce((b, s, i) => (s.len / s.sec > splits[b].len / splits[b].sec ? i : b), 0);
  const maxKmh = Math.max(...splits.map((s) => (s.len / s.sec) * 3.6), 1);

  return (
    <div className="mt-2">
      <LineChart
        title="속도 (km/h)"
        data={speed}
        color={SPEED_COLOR}
        unit="km/h"
        yStep={10}
        zeroBased
      />
      {elevation.length > 0 ? (
        <LineChart
          title={
            <>
              고도 (m) · 오르막 합계 <b className="text-slate-100">{Math.round(ascent)}m</b>
            </>
          }
          data={elevation}
          color={ELEV_COLOR}
          unit="m"
          area
          yStep={10}
          zeroBased={false}
        />
      ) : (
        <p className="mt-3 text-xs text-slate-500">이 기록에는 고도 정보가 없습니다.</p>
      )}

      {splits.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <caption className="mb-1 text-left text-xs text-slate-300">구간 기록 (1km마다)</caption>
          <thead className="text-slate-400">
            <tr>
              <th className="py-1 text-left font-normal">구간</th>
              <th className="py-1 text-right font-normal">시간</th>
              <th className="py-1 pl-3 text-left font-normal">평균 속도</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {splits.map((s, i) => {
              const kmh = (s.len / s.sec) * 3.6;
              return (
                <tr key={i} className="border-t border-slate-700/60">
                  <td className="py-1.5">
                    {s.len >= 999 ? `${Math.round(s.km)}km` : `+${(s.len / 1000).toFixed(1)}km`}
                    {i === fastest && splits.length > 1 && (
                      <span className="ml-1 rounded bg-slate-700 px-1 text-[10px] text-slate-200">최고</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">{formatDuration(s.sec)}</td>
                  <td className="py-1.5 pl-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-sm bg-slate-800">
                        <div
                          className="h-full rounded-sm"
                          style={{ width: `${(kmh / maxKmh) * 100}%`, background: SPEED_COLOR }}
                        />
                      </div>
                      <span className="w-16 text-right text-slate-100">{kmh.toFixed(1)}km/h</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
