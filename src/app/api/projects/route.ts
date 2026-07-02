import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { randomUUID } from "crypto";
import { initializeLoraStats } from "@/lib/job-manager";

export async function GET() {
  const projects = db
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, source_lang, target_lang } = body;

  if (!name || !source_lang || !target_lang) {
    return NextResponse.json(
      { error: "name, source_lang, target_lang are required" },
      { status: 400 }
    );
  }

  const id = randomUUID();
  const created_at = new Date().toISOString();

  db.prepare(
    "INSERT INTO projects (id, name, source_lang, target_lang, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, source_lang, target_lang, created_at);

  // LoRA 통계 초기화
  initializeLoraStats(id);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return NextResponse.json({ project }, { status: 201 });
}
