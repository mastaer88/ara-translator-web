import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { exportTranslatedImage } from "@/lib/image";
import path from "path";
import fs from "fs/promises";
import AdmZip from "adm-zip";

const uploadsDir = path.join(process.cwd(), "uploads");

// GET: 전체 프로젝트 내보내기 (ZIP/PDF)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const format = searchParams.get("format") || "zip"; // zip 또는 pdf
  const font = searchParams.get("font") || "serif"; // serif 또는 sans-serif
  const backgroundOpacity = parseFloat(searchParams.get("backgroundOpacity") || "0.8");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
    | { id: string; name: string }
    | undefined;

  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const pages = db
    .prepare("SELECT * FROM pages WHERE project_id = ? ORDER BY order_index ASC")
    .all(projectId) as { id: string; filename: string }[];

  if (pages.length === 0) {
    return NextResponse.json({ error: "no pages in project" }, { status: 400 });
  }

  try {
    // ZIP으로 내보내기 (PDF는 향후 추가)
    const zip = new AdmZip();

    for (const page of pages) {
      const regions = db
        .prepare("SELECT x, y, width, height, translated_text FROM regions WHERE page_id = ?")
        .all(page.id) as { x: number; y: number; width: number; height: number; translated_text: string }[];

      const imagePath = path.join(uploadsDir, projectId, page.filename);
      const imageBuffer = await exportTranslatedImage(imagePath, regions, {
        font,
        backgroundOpacity,
      });

      // ZIP에 이미지 추가
      const filename = page.filename.replace(/\.[^.]+$/, "-번역.png");
      zip.addFile(filename, imageBuffer);
    }

    const zipBuffer = zip.toBuffer();

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="project-translated.zip"`,
      },
    });
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json(
      { error: `Export failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

// POST: 기존 단일 페이지 내보내기 (하위 호환성)
export async function POST(req: NextRequest) {
  const { pageId } = await req.json();
  if (!pageId) {
    return NextResponse.json({ error: "pageId is required" }, { status: 400 });
  }

  const page = db.prepare("SELECT * FROM pages WHERE id = ?").get(pageId) as
    | { id: string; project_id: string; filename: string }
    | undefined;
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const regions = db
    .prepare("SELECT x, y, width, height, translated_text FROM regions WHERE page_id = ?")
    .all(pageId) as { x: number; y: number; width: number; height: number; translated_text: string }[];

  const imagePath = path.join(uploadsDir, page.project_id, page.filename);

  let buffer: Buffer;
  try {
    buffer = await exportTranslatedImage(imagePath, regions);
  } catch (err) {
    return NextResponse.json(
      { error: `Export failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${page.id}-translated.png"`,
    },
  });
}
