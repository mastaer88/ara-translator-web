"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

export function ToasterProvider() {
  const pathname = usePathname();

  // 전기자전거 화면: 속도계를 가리지 않도록 아래쪽(하단 버튼 위)에 짧게, 최대 2개만 표시
  if (pathname?.startsWith("/ebike")) {
    return (
      <Toaster
        position="bottom-center"
        theme="dark"
        richColors
        duration={2500}
        visibleToasts={2}
        offset={{ bottom: 110 }}
        // 지도 좌우 버튼(나침반·현재 위치)을 가리지 않도록 가운데에 좁게
        mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 96px)", left: 80, right: 80 }}
      />
    );
  }

  return <Toaster position="top-right" richColors theme="light" expand={true} closeButton />;
}
