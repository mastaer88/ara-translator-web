import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "better-sqlite3", "sharp"],

  // Vercel(외부 공개)에서는 번역기 화면을 숨기고 전기자전거 앱으로 보냄.
  // PC에서 dev.bat / npm start로 실행할 때는 번역기를 그대로 사용.
  async redirects() {
    if (!process.env.VERCEL) return [];
    return [
      { source: "/", destination: "/ebike", permanent: false },
      { source: "/project/:path*", destination: "/ebike", permanent: false },
    ];
  },
};

export default nextConfig;
