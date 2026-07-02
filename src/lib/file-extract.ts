import AdmZip from "adm-zip";
import { createCanvas } from "@napi-rs/canvas";

export type ExtractedImage = {
  filename: string;
  buffer: Buffer;
};

const IMAGE_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".tiff", ".tif", ".ico", ".svg", ".jpeg"
];

export function extractImagesFromZip(zipBuffer: Buffer): ExtractedImage[] {
  try {
    const zip = new AdmZip(zipBuffer);
    const allEntries = zip.getEntries();

    console.log(`📦 ZIP 파일 총 항목: ${allEntries.length}`);

    // 모든 비-디렉토리 항목 출력
    allEntries.forEach((e) => {
      if (!e.isDirectory) {
        console.log(`  - ${e.entryName} (${e.header.size} bytes)`);
      }
    });

    const entries = allEntries
      .filter((e) => {
        // 디렉토리 제외
        if (e.isDirectory) {
          return false;
        }

        // macOS의 __MACOSX, .DS_Store 등 제외
        if (
          e.entryName.includes("__MACOSX") ||
          e.entryName.startsWith(".") ||
          e.entryName.endsWith(".DS_Store")
        ) {
          console.log(`  ⏭️ 시스템 파일 제외: ${e.entryName}`);
          return false;
        }

        // 이미지 확장자 확인
        const isImage = IMAGE_EXTENSIONS.some((ext) =>
          e.entryName.toLowerCase().endsWith(ext)
        );

        if (!isImage) {
          console.log(`  ⏭️ 이미지 아님: ${e.entryName}`);
        }

        return isImage;
      })
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

    console.log(`✅ 추출 대상 이미지: ${entries.length}개`);

    if (entries.length === 0) {
      console.warn("⚠️ ZIP에서 이미지를 찾을 수 없습니다!");
      console.warn("  사용 가능한 포맷:", IMAGE_EXTENSIONS.join(", "));
    }

    return entries.map((e, idx) => {
      try {
        const buffer = e.getData();
        const filename = e.entryName.split("/").pop() || e.entryName;
        console.log(`  📸 [${idx + 1}/${entries.length}] ${filename} (${buffer.length} bytes)`);
        return {
          filename,
          buffer,
        };
      } catch (err) {
        console.error(`  ❌ Failed to extract ${e.entryName}:`, err);
        throw err;
      }
    });
  } catch (err) {
    console.error("❌ ZIP 추출 실패:", err);
    throw new Error(`ZIP 파일 처리 실패: ${(err as Error).message}`);
  }
}

export async function renderPdfToImages(pdfBuffer: Buffer): Promise<ExtractedImage[]> {
  // pdfjs-dist ships an ESM legacy build that works in Node without a DOM.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  const images: ExtractedImage[] = [];
  const pageCount = doc.numPages;
  const pad = String(pageCount).length;

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");

    await page.render({
      // @ts-expect-error - @napi-rs/canvas context is API-compatible with the DOM CanvasRenderingContext2D pdfjs expects
      canvasContext: ctx,
      viewport,
    }).promise;

    const buffer = canvas.toBuffer("image/png");
    images.push({
      filename: `page-${String(pageNum).padStart(pad, "0")}.png`,
      buffer,
    });
  }

  return images;
}
