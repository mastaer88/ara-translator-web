import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "전기자전거 속도계 · 내비",
  description: "아이폰에서 쓰는 전기자전거 속도계, 음성 안내, 자전거도로 우선 길찾기",
  manifest: "/ebike/manifest.webmanifest",
  icons: {
    icon: [{ url: "/ebike/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/ebike/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "E-Bike",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function EbikeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
