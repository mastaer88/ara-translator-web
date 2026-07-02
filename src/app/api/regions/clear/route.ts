import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function POST(req: NextRequest) {
  const { pageId } = await req.json();

  if (!pageId) {
    return NextResponse.json(
      { error: "pageId is required" },
      { status: 400 }
    );
  }

  try {
    db.prepare("DELETE FROM regions WHERE page_id = ?").run(pageId);
    db.prepare("UPDATE pages SET status = 'pending' WHERE id = ?").run(pageId);

    return NextResponse.json({ success: true, message: "OCR 초기화 완료" });
  } catch (err) {
    const errorMsg = (err as Error).message;
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
