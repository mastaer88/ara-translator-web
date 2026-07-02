import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "gemma3:4b";

async function validateWithLLM(text: string, language: string): Promise<string> {
  const langName = language === "ja" ? "Japanese" : language === "ko" ? "Korean" : language;

  const prompt = `This is OCR-extracted text in ${langName} from a comic/manga. The recognition confidence is low, so please validate and correct it if needed. Return ONLY the corrected text, nothing else.

Original text: ${text}`;

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM validation failed: ${res.status}`);
  }

  const data = await res.json();
  return (data.response as string).trim();
}

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
    .get(page.project_id) as { source_lang: string } | undefined;
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // 신뢰도 < 0.7인 영역만 LLM으로 재검증
  const lowConfidenceRegions = db
    .prepare("SELECT * FROM regions WHERE page_id = ? AND confidence < 0.7")
    .all(pageId) as { id: string; source_text: string }[];

  const update = db.prepare("UPDATE regions SET source_text = ? WHERE id = ?");

  for (const region of lowConfidenceRegions) {
    if (!region.source_text.trim()) continue;
    try {
      const validated = await validateWithLLM(region.source_text, project.source_lang);
      update.run(validated, region.id);
    } catch (err) {
      console.error(`LLM validation error for region ${region.id}:`, err);
      // 실패해도 계속 진행
    }
  }

  const savedRegions = db
    .prepare("SELECT * FROM regions WHERE page_id = ? ORDER BY y ASC, x ASC")
    .all(pageId);

  return NextResponse.json({
    validated: lowConfidenceRegions.length,
    regions: savedRegions,
  });
}
