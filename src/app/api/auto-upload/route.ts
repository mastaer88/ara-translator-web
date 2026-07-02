import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import db from "@/lib/db";
import { detectLanguage, mapToSupportedLanguage } from "@/lib/language-detect";
import { runOcr } from "@/lib/ocr";
import sharp from "sharp";

const uploadsDir = path.join(process.cwd(), "uploads");

/**
 * 파일 드래그 드롭 자동 업로드
 * 언어를 자동 감지하고 프로젝트를 자동 생성합니다.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // 여러 파일에서 언어 감지 (최대 3개 파일)
    let detectedLang = "en";
    const filesToProcess = files.slice(0, 3); // 첫 3개 파일만 샘플링

    try {
      const textSamples: string[] = [];

      for (const file of filesToProcess) {
        try {
          const buffer = await file.arrayBuffer();
          const bufferObj = Buffer.from(buffer);

          // 이미지 유효성 확인
          try {
            await sharp(bufferObj).metadata();
            console.log(`✓ Image valid: ${file.name}`);
          } catch (err) {
            console.warn(`⚠️ Invalid image format: ${file.name}, skipping OCR`);
            continue;
          }

          // 파일을 임시로 저장
          const tempPath = path.join(uploadsDir, `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.tmp`);
          await writeFile(tempPath, bufferObj);

          try {
            // OCR 실행 (다국어 감지를 위해 먼저 영어로 실행 - 대부분의 언어를 캐치함)
            const regions = await runOcr(tempPath, "en");

            // 감지된 텍스트 수집
            if (regions.length > 0) {
              const extractedText = regions
                .sort((a, b) => b.confidence - a.confidence) // 신뢰도 높은 순서
                .slice(0, 10) // 상위 10개
                .map((r) => r.text)
                .join(" ");

              if (extractedText.trim()) {
                textSamples.push(extractedText);
              }
            }
          } finally {
            // 임시 파일 삭제
            await unlink(tempPath).catch(() => {});
          }
        } catch (e) {
          console.error(`Error processing file ${file.name}:`, e);
          // 파일 처리 실패해도 다음 파일 계속
        }
      }

      // 수집된 텍스트에서 언어 감지
      if (textSamples.length > 0) {
        const combinedText = textSamples.join(" ");
        detectedLang = await detectLanguage(combinedText);
        console.log(`✓ Detected language: ${detectedLang} from ${textSamples.length} files`);
      }
    } catch (error) {
      console.error("Language detection failed:", error);
      // 실패해도 계속 진행 (기본값: ja)
    }

    // 지원하는 언어로 매핑
    const sourceLang = mapToSupportedLanguage(detectedLang);
    const targetLang = sourceLang === "ja" ? "ko" : sourceLang === "ko" ? "ja" : "en";

    // 프로젝트 자동 생성
    const projectId = randomUUID();
    const firstFile = files[0];
    const projectName = `${firstFile.name.split(".")[0]} 📄`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO projects (id, name, source_lang, target_lang, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(projectId, projectName, sourceLang, targetLang, now);

    // LoRA 통계 초기화
    db.prepare(
      `INSERT INTO lora_stats (id, project_id, total_pairs, reviewed_pairs, high_quality_pairs, training_status, training_progress, created_at, updated_at)
       VALUES (?, ?, 0, 0, 0, 'pending', 0, ?, ?)`
    ).run(randomUUID(), projectId, now, now);

    // 파일 업로드
    const projectUploadDir = path.join(uploadsDir, projectId);
    await require("fs/promises").mkdir(projectUploadDir, { recursive: true });

    const insertPage = db.prepare(
      `INSERT INTO pages (id, project_id, filename, status, order_index, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    );

    let orderIndex = 0;

    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const filename = `${randomUUID()}.${file.name.split(".").pop() || "jpg"}`;
      const filePath = path.join(projectUploadDir, filename);

      // 이미지 처리 및 저장
      if (filename.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
        const metadata = await sharp(Buffer.from(buffer)).metadata();
        await sharp(Buffer.from(buffer))
          .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
          .toFile(filePath);

        const pageId = randomUUID();
        insertPage.run(pageId, projectId, filename, orderIndex, now);
        orderIndex++;
      }
    }

    return NextResponse.json({
      projectId,
      projectName,
      sourceLang,
      targetLang,
      filesCount: files.length,
      message: `자동 감지 언어: ${sourceLang}`,
    });
  } catch (error) {
    console.error("Auto upload error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
