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

  if (typeof body.name === "string") {
    fields.push("name = ?");
    values.push(body.name);
  }
  if (typeof body.source_lang === "string") {
    fields.push("source_lang = ?");
    values.push(body.source_lang);
  }
  if (typeof body.target_lang === "string") {
    fields.push("target_lang = ?");
    values.push(body.target_lang);
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  values.push(id);
  db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return NextResponse.json({ project });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const pages = db
    .prepare("SELECT * FROM pages WHERE project_id = ? ORDER BY order_index ASC")
    .all(id);
  return NextResponse.json({ project, pages });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
