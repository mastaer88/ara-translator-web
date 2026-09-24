"use client";

import { useEffect, useState } from "react";
import type { LatLng } from "@/lib/ebike/geo";

type Props = {
  /** "check": 넘어짐 감지 후 괜찮은지 확인 / "sos": 긴급 화면 */
  mode: "check" | "sos";
  position: LatLng | null;
  address: string | null;
  contactName: string;
  contactPhone: string;
  onOk: () => void;
  onSos: () => void;
  onClose: () => void;
  say: (text: string) => void;
};

const COUNTDOWN = 30;

export default function SosOverlay(props: Props) {
  const { mode, position, address, contactName, contactPhone, say } = props;
  const [left, setLeft] = useState(COUNTDOWN);
  const { onSos } = props;

  // 확인 단계: 30초 안에 응답이 없으면 긴급 화면으로
  useEffect(() => {
    if (mode !== "check") return;
    say("넘어지셨나요? 괜찮으시면 화면의 괜찮아요 버튼을 눌러 주세요.");
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          onSos();
          return 0;
        }
        if ((s - 1) % 10 === 0) say(`괜찮으세요? ${s - 1}초 후 긴급 화면을 엽니다.`);
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [mode, say, onSos]);

  useEffect(() => {
    if (mode === "sos") say("긴급 모드입니다. 119 전화 또는 보호자에게 위치 문자를 보낼 수 있습니다.");
  }, [mode, say]);

  const mapLink = position ? `https://maps.apple.com/?ll=${position.lat},${position.lng}&q=${encodeURIComponent("사고 위치")}` : "";
  const message =
    `[E-Bike 긴급] 자전거 주행 중 사고가 난 것 같습니다.` +
    (address ? `\n위치: ${address}` : "") +
    (position ? `\n좌표: ${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}\n${mapLink}` : "");
  const phone = contactPhone.replace(/[^0-9+]/g, "");

  const share = async () => {
    try {
      await navigator.share({ title: "긴급 위치", text: message });
    } catch {
      // 취소
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] flex flex-col items-center justify-center gap-4 bg-red-800 p-6 text-center text-white">
      {mode === "check" ? (
        <>
          <div className="text-6xl">⚠️</div>
          <h2 className="text-3xl font-bold">넘어지셨나요?</h2>
          <p className="text-lg">
            <b className="font-mono text-4xl">{left}</b>초 후 긴급 화면을 엽니다
          </p>
          <button onClick={props.onOk} className="w-full max-w-sm rounded-2xl bg-white py-6 text-2xl font-bold text-red-800">
            괜찮아요
          </button>
          <button onClick={onSos} className="w-full max-w-sm rounded-2xl bg-black/30 py-4 text-xl font-bold">
            🆘 도움이 필요해요
          </button>
        </>
      ) : (
        <>
          <div className="text-6xl">🆘</div>
          <h2 className="text-3xl font-bold">긴급 도움 요청</h2>
          {address && <p className="text-sm opacity-90">현재 위치: {address}</p>}
          <a href="tel:119" className="w-full max-w-sm rounded-2xl bg-white py-5 text-2xl font-bold text-red-800">
            📞 119 전화
          </a>
          {phone ? (
            <a
              href={`sms:${phone}&body=${encodeURIComponent(message)}`}
              className="w-full max-w-sm rounded-2xl bg-white/90 py-4 text-xl font-bold text-red-800"
            >
              💬 {contactName || "보호자"}에게 위치 문자
            </a>
          ) : (
            <p className="text-sm opacity-90">설정에서 보호자 연락처를 등록하면 위치 문자를 바로 보낼 수 있습니다.</p>
          )}
          {phone && (
            <a href={`tel:${phone}`} className="w-full max-w-sm rounded-2xl bg-black/30 py-3 text-lg font-bold">
              📞 {contactName || "보호자"}에게 전화
            </a>
          )}
          <button onClick={share} className="w-full max-w-sm rounded-2xl bg-black/30 py-3 text-lg font-bold">
            ⤴︎ 위치 공유 (카카오톡 등)
          </button>
          <button onClick={props.onClose} className="mt-2 text-sm underline opacity-80">
            닫기
          </button>
        </>
      )}
    </div>
  );
}
