import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export async function GET(_req: NextRequest) {
  try {
    const fontConfigPath = path.join(process.cwd(), "public/fonts/fonts.json");
    const configContent = await fs.readFile(fontConfigPath, "utf-8");
    const config = JSON.parse(configContent);

    return NextResponse.json(config);
  } catch (err) {
    // 기본 폰트 반환
    return NextResponse.json({
      fonts: [
        {
          id: "serif",
          name: "세리프 (전통적)",
          category: "serif",
          preview: "전통적이고 우아한 스타일로 표시됩니다",
        },
        {
          id: "sans-serif",
          name: "산세리프 (현대적)",
          category: "sans-serif",
          preview: "깔끔하고 현대적인 스타일로 표시됩니다",
        },
      ],
    });
  }
}
