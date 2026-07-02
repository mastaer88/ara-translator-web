import sharp from "sharp";

export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
  translated_text: string;
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildOverlaySvg(
  width: number,
  height: number,
  regions: Region[],
  options: { font: string; backgroundOpacity: number } = { font: "serif", backgroundOpacity: 0.8 }
): string {
  const parts: string[] = [
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
  ];

  for (const r of regions) {
    if (!r.translated_text.trim()) continue;

    // 배경: 투명도 옵션 적용
    const bgOpacity = options.backgroundOpacity;
    parts.push(
      `<defs>
        <linearGradient id="bg-${r.x}-${r.y}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#ffffff;stop-opacity:${bgOpacity}" />
          <stop offset="100%" style="stop-color:#f5f5f5;stop-opacity:${bgOpacity}" />
        </linearGradient>
      </defs>`
    );

    parts.push(
      `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="url(#bg-${r.x}-${r.y})" stroke="none" />`
    );

    // 텍스트 크기 자동 조정 (높이와 너비 고려)
    let fontSize = Math.max(10, Math.min(32, Math.floor(r.height / 3.5)));

    // 텍스트가 너무 길면 폰트 사이즈 줄임
    if (r.translated_text.length > 20) {
      fontSize = Math.max(10, fontSize * 0.85);
    }

    const maxCharsPerLine = Math.max(4, Math.floor(r.width / (fontSize * 0.55)));
    const lines = wrapText(r.translated_text, maxCharsPerLine);
    const lineHeight = fontSize * 1.15;
    const totalTextHeight = lines.length * lineHeight;

    // 세로 중앙 정렬
    let startY = r.y + r.height / 2 - totalTextHeight / 2 + fontSize * 0.35;
    if (startY < r.y + fontSize) startY = r.y + fontSize;
    if (startY + totalTextHeight > r.y + r.height) {
      startY = r.y + r.height - totalTextHeight;
    }

    const centerX = r.x + r.width / 2;
    const tspans = lines
      .map(
        (line, i) =>
          `<tspan x="${centerX}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
      )
      .join("");

    // 글꼴 선택: font 옵션에 따라 다른 폰트 사용
    const fontFamily = options.font === "serif"
      ? "Georgia, '명조체', '명조', serif"  // 세리프 폰트 (전통적)
      : "Arial, '맑은 고딕', sans-serif";   // 산세리프 폰트 (현대적)

    parts.push(
      `<text x="${centerX}" y="${startY}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="500" fill="#1a1a1a" text-anchor="middle" letter-spacing="0.5">${tspans}</text>`
    );

    // 가는 경계선 추가 (선택사항)
    parts.push(
      `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="#e0e0e0" stroke-width="0.5" opacity="0.5" />`
    );
  }

  parts.push("</svg>");
  return parts.join("");
}

export async function exportTranslatedImage(
  imagePath: string,
  regions: Region[],
  options: { font?: string; backgroundOpacity?: number } = {}
): Promise<Buffer> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  const mergedOptions = {
    font: options.font ?? "serif",
    backgroundOpacity: options.backgroundOpacity ?? 0.8,
  };

  const svg = buildOverlaySvg(width, height, regions, mergedOptions);

  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
