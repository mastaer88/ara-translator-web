import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await req.json();

  const fields: string[] = [];
  const values: unknown[] = [];

  // 텍스트 필드
  if (typeof body.source_text === "string") {
    fields.push("source_text = ?");
    values.push(body.source_text);
  }
  if (typeof body.translated_text === "string") {
    fields.push("translated_text = ?");
    values.push(body.translated_text);
  }

  // 좌표 필드
  if (typeof body.x === "number") {
    fields.push("x = ?");
    values.push(body.x);
  }
  if (typeof body.y === "number") {
    fields.push("y = ?");
    values.push(body.y);
  }
  if (typeof body.width === "number") {
    fields.push("width = ?");
    values.push(body.width);
  }
  if (typeof body.height === "number") {
    fields.push("height = ?");
    values.push(body.height);
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  values.push(id);
  db.prepare(`UPDATE regions SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  const region = db.prepare("SELECT * FROM regions WHERE id = ?").get(id);
  return NextResponse.json({ region });
}
