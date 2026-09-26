"use client";

import { useRef, useState } from "react";
import {
  dashboardKm,
  estimateFuel,
  fillUp,
  maintStatus,
  setFuelPercent,
  type Dashboard,
  type FuelState,
  type MaintItem,
} from "@/lib/ebike/moto";
import { Row, Section, Sheet, Stat, Toggle } from "./ui";

type Props = {
  fuel: FuelState;
  /** 앱이 기록한 오토바이 누적 거리 (m) */
  appOdo: number;
  dash: Dashboard;
  maint: MaintItem[];
  maintEnabled: boolean;
  cameraCount: number;
  cameraImportedAt: number | null;
  onFuel: (f: FuelState, message?: string) => void;
  onDash: (d: Dashboard) => void;
  onMaint: (items: MaintItem[]) => void;
  onImportCameras: (file: File) => void;
  onClearCameras: () => void;
  onClose: () => void;
};

const LEVEL_COLOR = {
  ok: "bg-emerald-500",
  soon: "bg-amber-400",
  due: "bg-red-500",
} as const;

export default function MotoSheet(props: Props) {
  const { fuel, appOdo, dash, maint } = props;
  const est = estimateFuel(fuel, appOdo);
  const nowKm = dashboardKm(dash, appOdo);
  const [gauge, setGauge] = useState(
    Math.round((est?.percent ?? 100) / 10) * 10,
  );
  const [added, setAdded] = useState("");
  const [dashInput, setDashInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const setItem = (id: string, patch: Partial<MaintItem>) =>
    props.onMaint(maint.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  return (
    <Sheet title="🏍 오토바이" onClose={props.onClose}>
      {/* ───── 연료 ───── */}
      {est ? (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="연료 (추정)" value={`${Math.round(est.percent)}%`} />
          <Stat label="남은 양" value={`${est.liters.toFixed(1)}L`} />
          <Stat label="주행 가능" value={`약 ${Math.round(est.rangeKm)}km`} />
        </div>
      ) : (
        <p className="mb-4 rounded-xl bg-slate-800/50 p-3 text-sm text-slate-300">
          주유 후 &lsquo;가득 주유&rsquo;를 누르거나 연료 눈금을 입력하면, 달린
          거리만큼 줄여 가며 남은 주행 거리를 알려드립니다.
        </p>
      )}

      <Section title="⛽ 주유">
        <div className="flex items-center gap-2">
          <input
            value={added}
            onChange={(e) => setAdded(e.target.value)}
            inputMode="decimal"
            placeholder="넣은 양 L (선택)"
            aria-label="넣은 양 리터"
            className="w-0 flex-1 rounded-lg bg-slate-900 px-3 py-3"
          />
          <button
            onClick={() => {
              const l = parseFloat(added);
              const { fuel: next, measured } = fillUp(
                fuel,
                appOdo,
                l > 0 ? l : null,
              );
              props.onFuel(
                next,
                measured
                  ? `가득 주유 · 이번 연비 ${measured}km/L (평균 ${next.kmPerL}km/L)`
                  : "가득 주유로 기록했습니다",
              );
              setAdded("");
              setGauge(100);
            }}
            className="rounded-lg bg-emerald-500 px-4 py-3 font-bold text-black"
          >
            가득 주유
          </button>
        </div>
        <p className="text-xs text-slate-500">
          가득 넣을 때마다 넣은 양(L)을 적으면, 지난번 가득 주유 뒤 달린 거리로
          실제 연비를 배웁니다.
        </p>
        <div className="flex items-baseline justify-between text-sm">
          <span>지금 연료 눈금</span>
          <b className="font-mono text-lg">{gauge}%</b>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={gauge}
          onChange={(e) => setGauge(Number(e.target.value))}
          className="w-full accent-emerald-500"
          aria-label="연료 눈금"
        />
        <button
          onClick={() =>
            props.onFuel(
              setFuelPercent(fuel, gauge, appOdo),
              `연료 ${gauge}%로 맞췄습니다`,
            )
          }
          className="w-full rounded-lg bg-slate-700 py-2 text-sm"
        >
          눈금 {gauge}%로 맞추기
        </button>
        <Row label="연료 탱크 (L)">
          <NumberInput
            value={fuel.tankL}
            min={2}
            max={40}
            step={0.5}
            onChange={(v) => props.onFuel({ ...fuel, tankL: v })}
          />
        </Row>
        <Row
          label={`연비 (km/L)${fuel.learned ? ` · ${fuel.learned}번 학습` : ""}`}
        >
          <NumberInput
            value={fuel.kmPerL}
            min={8}
            max={120}
            step={1}
            onChange={(v) => props.onFuel({ ...fuel, kmPerL: v })}
          />
        </Row>
      </Section>

      <Section title="📟 계기판 거리">
        <Row label="지금 계기판 (추정)">
          <span className="font-mono">
            {Math.round(nowKm).toLocaleString()}km
          </span>
        </Row>
        <div className="flex gap-2">
          <input
            value={dashInput}
            onChange={(e) => setDashInput(e.target.value)}
            inputMode="numeric"
            placeholder="계기판 km 입력"
            aria-label="계기판 km"
            className="w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2"
          />
          <button
            onClick={() => {
              const km = parseFloat(dashInput);
              if (km >= 0) props.onDash({ km, appOdoAt: appOdo });
              setDashInput("");
            }}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm"
          >
            맞추기
          </button>
        </div>
        <p className="text-xs text-slate-500">
          한 번 맞춰 두면 이 앱으로 달린 거리만큼 늘어납니다. 앱 없이 탄 거리가
          쌓이면 가끔 다시 맞춰 주세요.
        </p>
      </Section>

      {props.maintEnabled && (
        <Section title="🔧 정비">
          <ul className="space-y-3">
            {maint.map((m) => {
              const st = maintStatus(m, nowKm);
              return (
                <li key={m.id} className={m.on ? "" : "opacity-50"}>
                  <Toggle
                    label={m.name}
                    value={m.on}
                    onChange={(on) => setItem(m.id, { on })}
                  />
                  {m.on && (
                    <div className="mt-1.5 text-xs text-slate-400">
                      {st ? (
                        <>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                            <div
                              className={`h-full ${LEVEL_COLOR[st.level]}`}
                              style={{ width: `${st.ratio * 100}%` }}
                            />
                          </div>
                          <div className="mt-1 flex justify-between">
                            <span
                              className={
                                st.level === "due"
                                  ? "font-semibold text-red-300"
                                  : ""
                              }
                            >
                              {st.leftKm > 0
                                ? `${Math.round(st.leftKm).toLocaleString()}km 남음`
                                : `${Math.round(-st.leftKm).toLocaleString()}km 지남 — 정비할 때입니다`}
                            </span>
                            <span>
                              마지막{" "}
                              {Math.round(m.lastKm ?? 0).toLocaleString()}km
                            </span>
                          </div>
                        </>
                      ) : (
                        <div>
                          마지막으로 한 때를 모릅니다. 방금 했다면
                          &lsquo;했어요&rsquo;를 누르세요.
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-2">
                        <span>주기</span>
                        <NumberInput
                          value={m.everyKm}
                          min={100}
                          max={50000}
                          step={100}
                          onChange={(everyKm) => setItem(m.id, { everyKm })}
                        />
                        <span>km</span>
                        <button
                          onClick={() =>
                            setItem(m.id, { lastKm: Math.round(nowKm) })
                          }
                          className="ml-auto rounded-lg bg-slate-700 px-3 py-1.5 text-slate-100"
                        >
                          했어요
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-slate-500">
            주기는 흔히 쓰는 값입니다. 내 오토바이 설명서에 맞게 바꾸세요.
            정비할 때가 되면 주행 시작 때 알려드립니다.
          </p>
        </Section>
      )}

      <Section title="📷 단속 카메라 데이터">
        <Row label="저장된 카메라">
          <span className="font-mono">
            {props.cameraCount.toLocaleString()}개
            {props.cameraImportedAt && (
              <span className="ml-1 text-xs text-slate-400">
                ({new Date(props.cameraImportedAt).toLocaleDateString("ko-KR")})
              </span>
            )}
          </span>
        </Row>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onImportCameras(f);
            e.target.value = "";
          }}
        />
        <div className="grid grid-cols-2 gap-2 text-sm">
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-blue-600 py-2 font-semibold"
          >
            파일 불러오기
          </button>
          <button
            onClick={() =>
              confirm("저장된 카메라 데이터를 지울까요?") &&
              props.onClearCameras()
            }
            className="rounded-lg bg-slate-700 py-2"
            disabled={props.cameraCount === 0}
          >
            지우기
          </button>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          공공데이터포털(data.go.kr)에서
          &lsquo;전국무인교통단속카메라표준데이터&rsquo;를 검색해 CSV 파일을
          받은 뒤 불러오세요. 한 번 불러오면 이 기기에 저장되고, 주행 중 앞쪽
          카메라를 500m 전에 음성으로 알려드립니다.
        </p>
      </Section>
    </Sheet>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <input
      value={text}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseFloat(text);
        if (v >= min && v <= max) onChange(Math.round(v / step) * step);
        else setText(String(value));
      }}
      className="w-20 rounded-lg bg-slate-900 px-2 py-1.5 text-right font-mono"
    />
  );
}
