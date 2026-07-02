import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function POST(req: NextRequest) {
  const { jobId } = await req.json();

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
    | { id: string; status: string; page_id: string }
    | undefined;

  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  // 진행 중인 작업만 취소 가능
  if (job.status !== "running" && job.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot cancel job with status: ${job.status}` },
      { status: 400 }
    );
  }

  try {
    // 작업 상태를 cancelled로 변경
    db.prepare("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), jobId);

    // 페이지 상태를 되돌리기 (선택사항)
    // OCR 취소: ocr_done 상태가 아니면 pending으로
    // translate 취소: ocr_done 상태로

    return NextResponse.json({
      success: true,
      message: "Job cancelled successfully",
      jobId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
