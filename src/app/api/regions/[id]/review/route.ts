import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const region = db.prepare("SELECT * FROM regions WHERE id = ?").get(id) as {
    id: string;
    page_id: string;
    source_text: string;
    translated_text: string;
    confidence: number;
  } | undefined;

  if (!region) {
    return NextResponse.json({ error: "region not found" }, { status: 404 });
  }

  const page = db.prepare("SELECT * FROM pages WHERE id = ?").get(region.page_id) as {
    id: string;
    project_id: string;
  } | undefined;

  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(page.project_id) as {
      id: string;
      source_lang: string;
      target_lang: string;
    } | undefined;

  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // 검수 완료한 번역 데이터를 LoRA 학습 데이터에 추가
  if (region.source_text.trim() && region.translated_text.trim()) {
    // 기존 entry가 있는지 확인
    const existing = db
      .prepare(
        "SELECT id FROM translation_pairs WHERE source_text = ? AND target_text = ? AND project_id = ?"
      )
      .get(region.source_text, region.translated_text, page.project_id) as
      | { id: string }
      | undefined;

    if (!existing) {
      const insertLora = db.prepare(
        `INSERT INTO translation_pairs (id, project_id, source_lang, target_lang, source_text, target_text, confidence, reviewed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
      );
      insertLora.run(
        randomUUID(),
        page.project_id,
        project.source_lang,
        project.target_lang,
        region.source_text,
        region.translated_text,
        region.confidence,
        new Date().toISOString()
      );
    } else {
      // 기존 entry를 reviewed로 표시
      db.prepare("UPDATE translation_pairs SET reviewed = 1 WHERE id = ?").run(existing.id);
    }
  }

  return NextResponse.json({ ok: true });
}
