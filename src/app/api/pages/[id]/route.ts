import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const page = db.prepare("SELECT * FROM pages WHERE id = ?").get(id);
  if (!page) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const regions = db
    .prepare("SELECT * FROM regions WHERE page_id = ? ORDER BY y ASC, x ASC")
    .all(id);
  return NextResponse.json({ page, regions });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  db.prepare("DELETE FROM pages WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
