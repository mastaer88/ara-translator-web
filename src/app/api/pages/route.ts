import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import { extractImagesFromZip, renderPdfToImages, type ExtractedImage } from "@/lib/file-extract";

const uploadsDir = path.join(process.cwd(), "uploads");

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  const pages = db
    .prepare("SELECT * FROM pages WHERE project_id = ? ORDER BY order_index ASC")
    .all(projectId);
  return NextResponse.json({ pages });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const projectId = formData.get("projectId");
  const files = formData.getAll("files");

  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "no files provided" }, { status: 400 });
  }

  await fs.mkdir(path.join(uploadsDir, projectId), { recursive: true });

  const countRow = db
    .prepare("SELECT COUNT(*) as cnt FROM pages WHERE project_id = ?")
    .get(projectId) as { cnt: number };
  let orderIndex = countRow.cnt;

  // Expand PDFs and ZIPs into individual page images; pass images through as-is.
  const images: ExtractedImage[] = [];
  for (const file of files) {
    if (!(file instanceof File)) continue;
    const ext = path.extname(file.name).toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    console.log(`📄 Processing file: ${file.name} (${buffer.length} bytes, type: ${file.type})`);

    try {
      if (ext === ".pdf" || file.type === "application/pdf") {
        console.log("  → PDF 렌더링 중...");
        const pdfImages = await renderPdfToImages(buffer);
        console.log(`  ✅ ${pdfImages.length}개 페이지 렌더링됨`);
        images.push(...pdfImages);
      } else if (ext === ".zip" || file.type === "application/zip") {
        console.log("  → ZIP 추출 중...");
        const zipImages = extractImagesFromZip(buffer);
        console.log(`  ✅ ${zipImages.length}개 이미지 추출됨`);
        images.push(...zipImages);
      } else {
        console.log(`  → 이미지로 처리`);
        images.push({ filename: file.name || `image${ext || ".png"}`, buffer });
      }
    } catch (err) {
      console.error(`❌ Error processing ${file.name}:`, err);
      return NextResponse.json(
        { error: `Failed to process "${file.name}": ${(err as Error).message}` },
        { status: 400 }
      );
    }
  }

  console.log(`📦 총 ${images.length}개 이미지 준비됨`);

  const created = [];
  for (const image of images) {
    try {
      const ext = path.extname(image.filename).toLowerCase() || ".png";
      const id = randomUUID();
      const filename = `${id}${ext}`;
      const filePath = path.join(uploadsDir, projectId, filename);

      console.log(`💾 이미지 저장 중: ${filename}`);

      // Sharp로 메타데이터 검증
      let metadata;
      try {
        metadata = await sharp(image.buffer).metadata();
        console.log(`  ✅ 이미지 유효함: ${metadata.width}x${metadata.height} (${metadata.format})`);
      } catch (err) {
        console.warn(`  ⚠️ 이미지 포맷 오류, PNG로 재인코딩 시도:`, (err as Error).message);
        // 손상된 이미지 처리: 재인코딩
        const reencoded = await sharp(image.buffer)
          .png()
          .toBuffer();
        metadata = await sharp(reencoded).metadata();
        console.log(`  ✅ 재인코딩 완료: ${metadata.width}x${metadata.height}`);
        await fs.writeFile(filePath, reencoded);
      }

      if (!metadata) {
        await fs.writeFile(filePath, image.buffer);
      } else {
        await fs.writeFile(filePath, image.buffer);
      }

      const created_at = new Date().toISOString();
      db.prepare(
        `INSERT INTO pages (id, project_id, filename, status, order_index, width, height, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`
      ).run(id, projectId, filename, orderIndex, metadata?.width ?? null, metadata?.height ?? null, created_at);

      created.push(db.prepare("SELECT * FROM pages WHERE id = ?").get(id));
      orderIndex++;
      console.log(`  ✅ 데이터베이스 저장 완료`);
    } catch (err) {
      console.error(`❌ 이미지 처리 실패:`, (err as Error).message);
      return NextResponse.json(
        { error: `Failed to process image: ${(err as Error).message}` },
        { status: 400 }
      );
    }
  }

  console.log(`🎉 총 ${created.length}개 페이지 생성됨`);
  return NextResponse.json({ pages: created }, { status: 201 });
}
