import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");

  let query = "SELECT * FROM translation_pairs WHERE 1=1";
  const params: unknown[] = [];

  if (projectId) {
    query += " AND project_id = ?";
    params.push(projectId);
  }

  const pairs = db.prepare(query).all(...params) as {
    source_lang: string;
    target_lang: string;
    confidence: number;
    reviewed: number;
  }[];

  const stats = {
    total: pairs.length,
    reviewed: pairs.filter((p) => p.reviewed === 1).length,
    byLangPair: {} as Record<string, number>,
    byConfidence: { high: 0, medium: 0, low: 0 },
    avgSourceLen: 0,
    avgTargetLen: 0,
  };

  // 언어쌍별 집계
  for (const pair of pairs) {
    const langPair = `${pair.source_lang}->${pair.target_lang}`;
    stats.byLangPair[langPair] = (stats.byLangPair[langPair] ?? 0) + 1;

    // 신뢰도별 집계
    if (pair.confidence >= 0.8) {
      stats.byConfidence.high++;
    } else if (pair.confidence >= 0.5) {
      stats.byConfidence.medium++;
    } else {
      stats.byConfidence.low++;
    }
  }

  return NextResponse.json(stats);
}
