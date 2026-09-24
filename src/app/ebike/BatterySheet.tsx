"use client";

import { useState } from "react";
import { estimateBattery, type BatteryState } from "@/lib/ebike/battery";
import { Row, Sheet, Stat } from "./ui";

type Props = {
  battery: BatteryState;
  odometer: number;
  onSetPercent: (percent: number) => void;
  onChange: (b: BatteryState) => void;
  onClose: () => void;
};

export default function BatterySheet({ battery, odometer, onSetPercent, onChange, onClose }: Props) {
  const est = estimateBattery(battery, odometer);
  const [percent, setPercent] = useState(Math.round(est?.percent ?? 100));
  const [volt, setVolt] = useState("");
  const [ah, setAh] = useState("");

  return (
    <Sheet title="🔋 배터리" onClose={onClose}>
      {est ? (
        <div className="grid grid-cols-2 gap-2 text-center">
          <Stat label="예상 잔량" value={`${Math.round(est.percent)}%`} />
          <Stat label="주행 가능 거리" value={`약 ${est.rangeKm.toFixed(0)}km`} />
        </div>
      ) : (
        <p className="rounded-xl bg-slate-800/50 p-3 text-sm text-slate-300">
          지금 배터리 %를 입력하면 달린 거리만큼 줄여 가며 남은 주행 거리를 알려드립니다.
        </p>
      )}

      <div className="mt-3 rounded-xl bg-slate-800/50 p-3">
        <div className="flex items-baseline justify-between text-sm">
          <span>지금 배터리 (계기판 표시)</span>
          <b className="font-mono text-xl">{percent}%</b>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          className="mt-2 w-full accent-emerald-500"
          aria-label="배터리 퍼센트"
        />
        <div className="mt-2 grid grid-cols-5 gap-1 text-sm">
          {[100, 80, 60, 40, 20].map((v) => (
            <button key={v} onClick={() => setPercent(v)} className="rounded-lg bg-slate-700 py-1.5">
              {v}%
            </button>
          ))}
        </div>
        <button
          onClick={() => onSetPercent(percent)}
          className="mt-3 w-full rounded-xl bg-emerald-500 py-3 font-bold text-black"
        >
          {percent}%로 저장
        </button>
        <p className="mt-2 text-xs text-slate-500">
          계기판 칸 수만 보이면 대략 입력해도 됩니다 (5칸 중 3칸 → 60%). 주행 후 다시 입력할수록 소모량이 내 주행에
          맞게 학습됩니다.
        </p>
      </div>

      <div className="mt-3 space-y-3 rounded-xl bg-slate-800/50 p-3 text-sm">
        <Row label="배터리 용량">
          <span className="font-mono">{battery.capacityWh}Wh</span>
        </Row>
        <div className="flex items-center gap-2">
          <input
            value={volt}
            onChange={(e) => setVolt(e.target.value)}
            inputMode="decimal"
            placeholder="전압 V (예: 36)"
            className="w-0 flex-1 rounded-lg bg-slate-900 px-2 py-2"
          />
          <span>×</span>
          <input
            value={ah}
            onChange={(e) => setAh(e.target.value)}
            inputMode="decimal"
            placeholder="용량 Ah (예: 10)"
            className="w-0 flex-1 rounded-lg bg-slate-900 px-2 py-2"
          />
          <button
            onClick={() => {
              const wh = Math.round(Number(volt) * Number(ah));
              if (wh >= 50 && wh <= 5000) onChange({ ...battery, capacityWh: wh });
            }}
            className="rounded-lg bg-slate-700 px-3 py-2"
          >
            적용
          </button>
        </div>
        <Row label="1km당 소모량">
          <span className="font-mono">
            {battery.whPerKm}Wh/km{" "}
            <span className="text-xs text-slate-400">
              {battery.learned ? `(주행 ${battery.learned}번 학습)` : "(기본값)"}
            </span>
          </span>
        </Row>
        <input
          type="range"
          min={4}
          max={25}
          step={0.5}
          value={battery.whPerKm}
          onChange={(e) => onChange({ ...battery, whPerKm: Number(e.target.value) })}
          className="w-full accent-emerald-500"
          aria-label="1km당 소모량"
        />
        <p className="text-xs text-slate-500">
          보통 7~15Wh/km (보조 단계가 높거나 오르막·맞바람이 많으면 더 큼). 배터리 라벨의 V와 Ah를 곱하면 용량입니다.
        </p>
      </div>
    </Sheet>
  );
}
