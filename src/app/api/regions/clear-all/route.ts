import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function POST(req: NextRequest) {
  const { projectId } = await req.json();

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  try {
    // 해당 프로젝트의 모든 페이지 가져오기
    const pages = db.prepare("SELECT id FROM pages WHERE project_id = ?").all(projectId) as { id: string }[];

    // 모든 페이지의 regions 삭제
    db.prepare("DELETE FROM regions WHERE page_id IN (SELECT id FROM pages WHERE project_id = ?)").run(projectId);

    // 모든 페이지 상태를 'pending'으로 리셋
    db.prepare("UPDATE pages SET status = 'pending' WHERE project_id = ?").run(projectId);

    return NextResponse.json({
      success: true,
      message: "전체 OCR 초기화 완료",
      pagesCleared: pages.length
    });
  } catch (err) {
    const errorMsg = (err as Error).message;
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
