import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const onlyReviewed = req.nextUrl.searchParams.get("onlyReviewed") === "true";

  let query = "SELECT * FROM translation_pairs WHERE 1=1";
  const params: unknown[] = [];

  if (projectId) {
    query += " AND project_id = ?";
    params.push(projectId);
  }

  if (onlyReviewed) {
    query += " AND reviewed = 1";
  }

  query += " ORDER BY created_at ASC";

  const pairs = db.prepare(query).all(...params) as {
    source_lang: string;
    target_lang: string;
    source_text: string;
    target_text: string;
    confidence: number;
    reviewed: number;
  }[];

  const jsonl = pairs
    .map((p) =>
      JSON.stringify({
        source_lang: p.source_lang,
        target_lang: p.target_lang,
        source_text: p.source_text,
        target_text: p.target_text,
        confidence: p.confidence,
        reviewed: p.reviewed === 1,
      })
    )
    .join("\n");

  return new NextResponse(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="lora-training-data-${Date.now()}.jsonl"`,
    },
  });
}
