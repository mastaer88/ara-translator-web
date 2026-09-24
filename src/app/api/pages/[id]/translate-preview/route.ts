import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import path from "path";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";

const uploadsDir = path.join(process.cwd(), "uploads");

/**
 * 번역 미리보기 이미지 생성
 * 원문을 흐리게 처리하고 번역 텍스트를 오버레이
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pageId } = await params;
  const quality = req.nextUrl.searchParams.get("quality") || "85";

  try {
    // 페이지 정보 조회
    const page = db
      .prepare("SELECT * FROM pages WHERE id = ?")
      .get(pageId) as {
      id: string;
      project_id: string;
      filename: string;
      width: number;
      height: number;
    } | undefined;

    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    // 원본 이미지 경로
    const imagePath = path.join(uploadsDir, page.project_id, page.filename);

    // 원본 이미지 읽기
    let imageBuffer = await sharp(imagePath).toBuffer();
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 768;

    // Canvas를 사용해 번역 오버레이 생성
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 원본 이미지를 캔버스에 그리기
    const image = await sharp(imageBuffer).toBuffer();
    const imageData = await sharp(image).toBuffer();

    // 이미지를 어둡게 처리 (30% 명도만 유지)
    const dimmedImageBuffer = await sharp(image)
      .modulate({ brightness: 0.3 })
      .toBuffer();

    // 지역 정보 조회
    const regions = db
      .prepare("SELECT * FROM regions WHERE page_id = ?")
      .all(pageId) as {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      source_text: string;
      translated_text: string;
    }[];

    // 기존 이미지에 텍스트 오버레이 처리
    // Sharp는 텍스트 렌더링이 제한적이므로, SVG를 사용
    let svgOverlay = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

    for (const region of regions) {
      if (!region.translated_text.trim()) continue;

      const fontSize = Math.max(12, Math.min(region.height / 2.5, 32));
      const textColor = "#000000";

      svgOverlay += `
        <g>
          <!-- 반투명 배경 -->
          <rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}"
                fill="#ffffff" opacity="0.9" />
          <!-- 텍스트 -->
          <text x="${region.x + region.width / 2}" y="${region.y + region.height / 2 + fontSize / 3}"
                text-anchor="middle" font-size="${fontSize}" font-weight="bold"
                fill="${textColor}" font-family="Arial, sans-serif">
            ${escapeXml(region.translated_text.substring(0, 30))}
          </text>
        </g>
      `;
    }

    svgOverlay += `</svg>`;

    // 원본 이미지 + 어두운 처리 + SVG 오버레이 합성
    const result = await sharp(imagePath)
      .modulate({ brightness: 0.3 }) // 원본을 어둡게
      .composite([
        {
          input: Buffer.from(svgOverlay),
          top: 0,
          left: 0,
        },
      ])
      .webp({ quality: parseInt(quality) })
      .toBuffer();

    return new NextResponse(result, {
      headers: { "Content-Type": "image/webp" },
    });
  } catch (err) {
    console.error("[TranslatePreview] Error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
