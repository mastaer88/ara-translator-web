import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { runOcr } from "@/lib/ocr";
import { randomUUID } from "crypto";
import path from "path";

const uploadsDir = path.join(process.cwd(), "uploads");

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

  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(page.project_id) as { source_lang: string } | undefined;
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const imagePath = path.join(uploadsDir, page.project_id, page.filename);

  // 작업 기록 생성
  const jobId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO jobs (id, project_id, page_id, type, status, progress, created_at, updated_at)
     VALUES (?, ?, ?, 'ocr', 'running', 0, ?, ?)`
  ).run(jobId, page.project_id, pageId, now, now);

  let regions;
  try {
    regions = await runOcr(imagePath, project.source_lang);

    // 진행률 업데이트
    db.prepare("UPDATE jobs SET progress = 50 WHERE id = ?").run(jobId);

    const insert = db.prepare(
      `INSERT INTO regions (id, page_id, x, y, width, height, source_text, translated_text, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`
    );

    db.prepare("DELETE FROM regions WHERE page_id = ?").run(pageId);
    const tx = db.transaction((items: typeof regions) => {
      for (const r of items) {
        insert.run(randomUUID(), pageId, r.x, r.y, r.width, r.height, r.text, r.confidence);
      }
    });
    tx(regions);

    db.prepare("UPDATE pages SET status = 'ocr_done' WHERE id = ?").run(pageId);

    // 작업 완료
    db.prepare("UPDATE jobs SET status = 'completed', progress = 100, updated_at = ?, completed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), jobId);
  } catch (err) {
    const errorMsg = (err as Error).message;
    // 작업 실패
    db.prepare("UPDATE jobs SET status = 'failed', error_msg = ?, updated_at = ? WHERE id = ?")
      .run(errorMsg, new Date().toISOString(), jobId);
    return NextResponse.json(
      { error: `OCR failed: ${errorMsg}` },
      { status: 500 }
    );
  }

  const savedRegions = db
    .prepare("SELECT * FROM regions WHERE page_id = ? ORDER BY y ASC, x ASC")
    .all(pageId);

  return NextResponse.json({ regions: savedRegions });
}
