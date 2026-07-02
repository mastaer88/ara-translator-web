import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { translateText } from "@/lib/translate";
import { logPageAction } from "@/lib/page-log";
import { randomUUID } from "crypto";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const { pageId } = await req.json();

  const region = db.prepare("SELECT * FROM regions WHERE id = ?").get(id) as {
    id: string;
    page_id: string;
    source_text: string;
  } | undefined;

  if (!region) {
    return NextResponse.json({ error: "region not found" }, { status: 404 });
  }

  if (!region.source_text?.trim()) {
    return NextResponse.json(
      { error: "source_text is empty" },
      { status: 400 }
    );
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

  try {
    const translated = await translateText(
      region.source_text,
      project.source_lang,
      project.target_lang
    );

    // regions 테이블 업데이트
    db.prepare("UPDATE regions SET translated_text = ? WHERE id = ?").run(
      translated,
      id
    );

    // translation_pairs 테이블에 추가 (LoRA 학습 데이터)
    const existing = db
      .prepare(
        "SELECT id FROM translation_pairs WHERE source_text = ? AND target_text = ? AND project_id = ?"
      )
      .get(region.source_text, translated, page.project_id) as
      | { id: string }
      | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO translation_pairs (id, project_id, source_lang, target_lang, source_text, target_text, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1.0, ?)`
      ).run(
        randomUUID(),
        page.project_id,
        project.source_lang,
        project.target_lang,
        region.source_text,
        translated,
        new Date().toISOString()
      );
    }

    logPageAction(pageId, "translate");
    return NextResponse.json({ success: true, translated });
  } catch (err) {
    logPageAction(pageId, "translate", "error", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
