"use client";

import { useState } from "react";

/** 처음 사용하는 사람을 위한 안내 (처음 한 번 자동 표시, 설정에서 다시 보기) */

const KEY = "ebike-onboarded-v1";

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

export function markOnboarded() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // 무시
  }
}

/** 홈 화면 앱(standalone)으로 실행 중인지 */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

type Props = {
  onDone: () => void;
  onOpenBattery: () => void;
  onOpenSettings: () => void;
};

export default function Onboarding({ onDone, onOpenBattery, onOpenSettings }: Props) {
  const [step, setStep] = useState(0);
  const standalone = isStandalone();

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: "전기자전거 속도계 · 내비",
      body: (
        <>
          <div className="mb-4 text-6xl">🚲⚡</div>
          <ul className="space-y-2 text-left text-base">
            <li>🔢 실시간 속도계와 주행 기록</li>
            <li>🗺 자전거도로 우선 길찾기 + 음성 안내</li>
            <li>🔋 배터리로 갈 수 있는 거리</li>
            <li>🅿️ 주차 위치 저장 · 🆘 넘어짐 감지</li>
          </ul>
          <p className="mt-4 text-sm text-slate-400">무료 · 로그인 없음 · 기록은 내 폰에만 저장됩니다</p>
        </>
      ),
    },
    {
      title: "홈 화면에 추가하기",
      body: standalone ? (
        <>
          <div className="mb-4 text-6xl">✅</div>
          <p className="text-base">이미 홈 화면 앱으로 실행 중입니다.</p>
        </>
      ) : (
        <>
          <p className="mb-4 text-base">앱처럼 전체 화면으로 쓰려면 홈 화면에 추가하세요.</p>
          <ol className="space-y-3 text-left text-base">
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold">
                1
              </span>
              <span>
                Safari 아래쪽의 <b>공유 버튼</b>{" "}
                <span className="inline-block rounded bg-slate-700 px-1.5">⬆︎</span>을 누릅니다
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold">
                2
              </span>
              <span>
                목록을 올려 <b>홈 화면에 추가</b>를 누릅니다
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold">
                3
              </span>
              <span>
                홈 화면의 <b>E-Bike</b> 아이콘으로 실행합니다
              </span>
            </li>
          </ol>
          <p className="mt-4 text-xs text-slate-400">
            카카오톡 등 다른 앱 안에서 열었다면 먼저 “Safari로 열기”를 누르세요.
          </p>
        </>
      ),
    },
    {
      title: "허용해 주세요",
      body: (
        <ul className="space-y-3 text-left text-base">
          <li>
            📍 <b>위치</b> — 처음 “주행 시작”을 누르면 묻습니다. <b>허용</b>을 눌러야 속도계와 길찾기가
            동작합니다.
          </li>
          <li>
            📱 <b>동작 및 방향</b> — 넘어짐 감지에 필요합니다. 물어보면 <b>허용</b>.
          </li>
          <li>
            🔊 <b>소리</b> — 음성 안내가 안 들리면 옆면 무음 스위치와 볼륨을 확인하세요.
          </li>
          <li>
            🔆 <b>화면</b> — 웹앱이라 화면이 꺼지면 안내가 멈춥니다. 거치대에 두고 화면을 켠 채로 쓰세요.
          </li>
        </ul>
      ),
    },
    {
      title: "시작 전에 (선택)",
      body: (
        <div className="space-y-3 text-left text-base">
          <button
            onClick={onOpenBattery}
            className="flex w-full items-center gap-3 rounded-2xl bg-slate-800 p-4 text-left active:bg-slate-700"
          >
            <span className="text-3xl">🔋</span>
            <span>
              <b>배터리 % 입력</b>
              <br />
              <span className="text-sm text-slate-400">남은 주행 거리를 알려드립니다</span>
            </span>
          </button>
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-3 rounded-2xl bg-slate-800 p-4 text-left active:bg-slate-700"
          >
            <span className="text-3xl">🆘</span>
            <span>
              <b>보호자 연락처 등록</b>
              <br />
              <span className="text-sm text-slate-400">
                넘어졌을 때 위치 문자를 바로 보냅니다 (설정 → 안전)
              </span>
            </span>
          </button>
          <p className="text-sm text-slate-400">나중에 설정에서도 할 수 있습니다.</p>
        </div>
      ),
    },
  ];

  const last = step === steps.length - 1;
  const cur = steps[step];

  return (
    <div
      className="fixed inset-0 z-[2500] flex flex-col bg-[#0b1220] px-6 text-center text-slate-100"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 16px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="사용 안내"
    >
      <div className="flex justify-end">
        <button onClick={onDone} className="px-2 py-1 text-sm text-slate-400">
          건너뛰기
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center overflow-y-auto">
        <h2 className="mb-6 text-2xl font-bold">{cur.title}</h2>
        {cur.body}
      </div>
      <div className="mx-auto w-full max-w-md">
        <div className="mb-4 flex justify-center gap-2" aria-label={`${step + 1} / ${steps.length}`}>
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all ${i === step ? "w-6 bg-emerald-400" : "w-2 bg-slate-600"}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 rounded-2xl bg-slate-800 py-4 text-lg font-bold"
            >
              이전
            </button>
          )}
          <button
            onClick={() => (last ? onDone() : setStep(step + 1))}
            className="flex-[2] rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-black"
          >
            {last ? "시작하기" : "다음"}
          </button>
        </div>
      </div>
    </div>
  );
}
