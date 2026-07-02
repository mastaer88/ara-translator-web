import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { runOcr } from "@/lib/ocr";
import { logPageAction } from "@/lib/page-log";
import path from "path";

const uploadsDir = path.join(process.cwd(), "uploads");

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const { pageId } = await req.json();

  const region = db.prepare("SELECT * FROM regions WHERE id = ?").get(id) as {
    id: string;
    page_id: string;
  } | undefined;

  if (!region) {
    return NextResponse.json({ error: "region not found" }, { status: 404 });
  }

  const page = db.prepare("SELECT * FROM pages WHERE id = ?").get(region.page_id) as {
    id: string;
    project_id: string;
    filename: string;
  } | undefined;

  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(page.project_id) as { source_lang: string } | undefined;

  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  try {
    const imagePath = path.join(uploadsDir, page.project_id, page.filename);
    const ocrResults = await runOcr(imagePath, project.source_lang);

    // 현재 region의 좌표와 일치하는 OCR 결과 찾기
    const currentRegion = db.prepare("SELECT * FROM regions WHERE id = ?").get(id) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };

    const matchingResult = ocrResults.find(
      (r) =>
        Math.abs(r.x - currentRegion.x) < 10 &&
        Math.abs(r.y - currentRegion.y) < 10 &&
        Math.abs(r.width - currentRegion.width) < 10 &&
        Math.abs(r.height - currentRegion.height) < 10
    );

    if (matchingResult) {
      db.prepare("UPDATE regions SET source_text = ?, confidence = ? WHERE id = ?").run(
        matchingResult.text,
        matchingResult.confidence,
        id
      );
      logPageAction(pageId, "ocr");
      return NextResponse.json({ success: true, text: matchingResult.text });
    } else {
      // 정확한 매칭이 없으면 가장 가까운 것 사용
      return NextResponse.json(
        { error: "No matching OCR result found for this region" },
        { status: 400 }
      );
    }
  } catch (err) {
    logPageAction(pageId, "ocr", "error", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
