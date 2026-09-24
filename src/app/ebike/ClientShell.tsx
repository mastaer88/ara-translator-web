"use client";

import dynamic from "next/dynamic";

// 위치·음성·지도 등 브라우저 전용 API를 쓰므로 서버 렌더링을 하지 않는다
const EbikeApp = dynamic(() => import("./EbikeApp"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0b1220] text-slate-300">
      불러오는 중…
    </div>
  ),
});

export default function ClientShell() {
  return <EbikeApp />;
}
