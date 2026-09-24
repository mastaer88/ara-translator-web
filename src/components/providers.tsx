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
        mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 96px)" }}
      />
    );
  }

  return <Toaster position="top-right" richColors theme="light" expand={true} closeButton />;
}
