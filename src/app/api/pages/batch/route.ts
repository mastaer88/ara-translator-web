import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { runOcr } from "@/lib/ocr";
import { translateText } from "@/lib/translate";
import { logPageAction } from "@/lib/page-log";
import { updateLoraStats, updateJobStatus, createJob } from "@/lib/job-manager";
import { randomUUID } from "crypto";
import path from "path";

const uploadsDir = path.join(process.cwd(), "uploads");

export async function POST(req: NextRequest) {
  const { action, pageIds, projectId } = await req.json();

  if (!action || !pageIds || pageIds.length === 0) {
    return NextResponse.json(
      { error: "action and pageIds are required" },
      { status: 400 }
    );
  }

  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as { source_lang: string; target_lang: string } | undefined;

  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const results = [];
  let totalTranslatedCount = 0;

  for (let index = 0; index < pageIds.length; index++) {
    const pageId = pageIds[index];
    const page = db.prepare("SELECT * FROM pages WHERE id = ?").get(pageId) as
      | { id: string; project_id: string; filename: string }
      | undefined;

    if (!page) continue;

    const jobId = randomUUID();
    const job = createJob(projectId, pageId, action === "ocr" ? "ocr" : "translate");

    try {
      if (action === "ocr") {
        const imagePath = path.join(uploadsDir, page.project_id, page.filename);
        const regions = await runOcr(imagePath, project.source_lang);

        // 진행률 업데이트
        updateJobStatus(job.id, "running", Math.round(((index + 1) / pageIds.length) * 100));

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
        logPageAction(pageId, "ocr");

        // 작업 완료
        updateJobStatus(job.id, "completed", 100);
        results.push({ pageId, status: "success", action: "ocr" });
      } else if (action === "translate") {
        console.log(`[BATCH TRANSLATE] Starting translation for page ${pageId}`);

        // 진행률 업데이트 - 시작
        updateJobStatus(job.id, "running", Math.round(((index + 0.25) / pageIds.length) * 100));

        const regions = db.prepare("SELECT * FROM regions WHERE page_id = ?").all(pageId) as {
          id: string;
          source_text: string;
        }[];
        console.log(`[BATCH TRANSLATE] Found ${regions.length} regions`);

        const update = db.prepare("UPDATE regions SET translated_text = ? WHERE id = ?");
        const insertLora = db.prepare(
          `INSERT INTO translation_pairs (id, project_id, source_lang, target_lang, source_text, target_text, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );

        let translatedCount = 0;
        for (const region of regions) {
          if (!region.source_text.trim()) continue;
          const translated = await translateText(
            region.source_text,
            project.source_lang,
            project.target_lang
          );
          update.run(translated, region.id);
          insertLora.run(
            randomUUID(),
            page.project_id,
            project.source_lang,
            project.target_lang,
            region.source_text,
            translated,
            1.0,
            new Date().toISOString()
          );
          translatedCount++;
        }

        console.log(`[BATCH TRANSLATE] Translated ${translatedCount} regions for page ${pageId}`);
        totalTranslatedCount += translatedCount;

        db.prepare("UPDATE pages SET status = 'translated' WHERE id = ?").run(pageId);
        logPageAction(pageId, "translate");

        // 작업 완료
        updateJobStatus(job.id, "completed", Math.round(((index + 1) / pageIds.length) * 100));
        results.push({ pageId, status: "success", action: "translate", translatedRegions: translatedCount });
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      logPageAction(pageId, action as any, "error", errorMsg);
      updateJobStatus(job.id, "failed", 0, undefined, errorMsg);
      results.push({ pageId, status: "error", action, error: errorMsg });
    }
  }

  // 모든 페이지 처리 후 LoRA 통계 한 번에 업데이트
  if (action === "translate" && totalTranslatedCount > 0) {
    console.log(`[BATCH TRANSLATE] All pages completed. Total translated: ${totalTranslatedCount}`);
    console.log(`[BATCH TRANSLATE] Updating LoRA stats for project ${projectId}`);

    const stats = db.prepare("SELECT * FROM lora_stats WHERE project_id = ?").get(projectId) as {
      total_pairs: number;
      high_quality_pairs: number;
    } | null;

    console.log(`[BATCH TRANSLATE] Current stats:`, stats);

    if (stats) {
      console.log(`[BATCH TRANSLATE] Calling updateLoraStats with +${totalTranslatedCount} pairs`);
      updateLoraStats(projectId, {
        total_pairs: stats.total_pairs + totalTranslatedCount,
        high_quality_pairs: stats.high_quality_pairs + totalTranslatedCount,
      });
      console.log(`[BATCH TRANSLATE] LoRA stats updated successfully`);
    } else {
      console.log(`[BATCH TRANSLATE] No LoRA stats found for project`);
    }
  }

  return NextResponse.json({ results });
}
