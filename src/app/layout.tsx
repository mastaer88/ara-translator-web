import type { Metadata } from "next";
import { Baloo_2, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { ToasterProvider } from "@/components/providers";

const baloo = Baloo_2({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const notoSansKr = Noto_Sans_KR({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "아라 번역 🌸",
  description: "이미지/만화 OCR 기반 번역 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${baloo.variable} ${notoSansKr.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ToasterProvider />
        {children}
      </body>
    </html>
  );
}
