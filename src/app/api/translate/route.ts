import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { translateText } from "@/lib/translate";
import { checkTranslationQuality } from "@/lib/data-quality";
import { createJob, updateJobStatus, updateLoraStats, getLoraStats } from "@/lib/job-manager";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const { pageId } = await req.json();
  if (!pageId) {
    return NextResponse.json({ error: "pageId is required" }, { status: 400 });
  }

  const page = db.prepare("SELECT * FROM pages WHERE id = ?").get(pageId) as
    | { id: string; project_id: string }
    | undefined;
  if (!page) {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }

  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(page.project_id) as { source_lang: string; target_lang: string } | undefined;
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // Job 생성
  const job = createJob(page.project_id, pageId, "translate");
  updateJobStatus(job.id, "running", 10);

  const regions = db
    .prepare("SELECT * FROM regions WHERE page_id = ?")
    .all(pageId) as { id: string; source_text: string; confidence: number }[];

  const update = db.prepare("UPDATE regions SET translated_text = ? WHERE id = ?");
  const insertLora = db.prepare(
    `INSERT INTO translation_pairs (id, project_id, source_lang, target_lang, source_text, target_text, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let successCount = 0;
  let qualityCount = 0;

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (!region.source_text.trim()) continue;

    try {
      const translated = await translateText(
        region.source_text,
        project.source_lang,
        project.target_lang
      );
      update.run(translated, region.id);

      // 데이터 품질 검사
      const qualityCheck = checkTranslationQuality(
        region.source_text,
        translated,
        region.confidence
      );

      // 고품질 데이터만 LoRA에 저장
      if (qualityCheck.isValid) {
        insertLora.run(
          randomUUID(),
          page.project_id,
          project.source_lang,
          project.target_lang,
          region.source_text,
          translated,
          region.confidence,
          new Date().toISOString()
        );
        qualityCount++;
      }

      successCount++;
      updateJobStatus(job.id, "running", Math.round(((i + 1) / regions.length) * 90) + 10);
    } catch (err) {
      console.error(`Translation failed for region ${region.id}:`, err);
    }
  }

  db.prepare("UPDATE pages SET status = 'translated' WHERE id = ?").run(pageId);

  // LoRA 통계 업데이트
  const loraStats = getLoraStats(page.project_id);
  if (loraStats) {
    updateLoraStats(page.project_id, {
      total_pairs: loraStats.total_pairs + successCount,
      high_quality_pairs: loraStats.high_quality_pairs + qualityCount,
    });
  }

  updateJobStatus(job.id, "completed", 100);

  const savedRegions = db
    .prepare("SELECT * FROM regions WHERE page_id = ? ORDER BY y ASC, x ASC")
    .all(pageId);

  return NextResponse.json({
    regions: savedRegions,
    stats: {
      translated: successCount,
      qualityData: qualityCount,
    },
  });
}
